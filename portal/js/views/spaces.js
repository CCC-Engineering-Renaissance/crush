// Spaces and pages: a Notion-style tree of pages per space, each space with a Drive folder and a task board.
// A space's home also sums up its tasks and its subteam (space-overview.js).
import { html, useState, useEffect, useRef, useMemo, Icon, Avatar, Modal, openModal, Field, Menu, Loading, Empty, Notice, useAsync, toast, toastError, confirmDialog, EmojiPicker, ItemIcon } from '../lib/ui.js';
import { useStore, setState, isLead, isAdmin, getState, bump, canSeeSpace, visibleSpaces, groupBySubsidiary, subsidiaryById, subteamById, subteamLabel, treeOf } from '../lib/store.js';
import { useRoute, href, go } from '../lib/router.js';
import { relTime, fmtDateTime } from '../lib/time.js';
import { nest, pathTo, descendants } from '../data/tree.js';
import { BlocksView, EditorHost, DriveBlock, toggleChecklist } from './editor.js';
import { driveConfigured, pickFromDrive, parseDriveLink } from '../google/drive.js';
import { useTitle, SpaceIcon } from './common.js';
import { openIconPicker } from './space-icon.js';
import { SpaceTasks, SpaceTeam } from './space-overview.js';

const canEditSpace = (space, profile) => canSeeSpace(space, profile) && (isLead(profile) || !!space?.memberEdit);
const useTree = (spaceId) => useStore((s) => treeOf(spaceId, s));
const pageCount = (n) => (n === 1 ? '1 page' : `${n} pages`);

// ───────── All spaces ─────────
export function SpacesIndex() {
  useTitle('Spaces');
  const { profile, subsidiaries, contents } = useStore((s) => ({ profile: s.profile, subsidiaries: s.subsidiaries, contents: s.contents }));
  const spaces = useStore((s) => visibleSpaces(s));
  const groups = groupBySubsidiary(spaces, subsidiaries).filter((g) => g.items.length);
  const row = (s) => html`<li key=${s.id} style="align-items:center">
    <span class="space-glyph"><${SpaceIcon} space=${s} size=${22} /></span>
    <span class="grow"><a class="title" href=${href('/s/' + s.id)}>${s.name}</a>${s.private && html`<span class="badge" style="margin-left:8px"><${Icon} name="lock" size=${12} />Private</span>`}
      <div class="meta">${s.description || ''}</div></span>
    <span class="small muted nowrap">${pageCount((contents[s.id]?.tree || []).length)}</span>
    <a class="btn btn-sm" href=${href(`/s/${s.id}/board`)}><${Icon} name="board" />Board</a>
  </li>`;
  return html`<div class="content">
    <div class="page-head"><div><h1>Spaces</h1><p>Each space holds pages, a task board and a Google Drive folder. They’re grouped by subsidiary, like channels in Discord.</p></div>
      ${isAdmin(profile) && html`<div class="actions"><button class="btn" onClick=${() => openNewSpace({})}><${Icon} name="plus" />New space</button></div>`}</div>
    ${!groups.length ? html`<div class="panel"><${Empty} title="No spaces yet">${isAdmin(profile) ? 'Create spaces in Admin, or add the starter set.' : 'An admin sets these up, or hasn’t added you to any yet.'}</${Empty}></div>`
    : groups.map((g) => html`<section key=${g.sub?.id || '-'} style="margin-bottom:20px">
        ${(g.sub || groups.length > 1) && html`<h2 class="section-title" style="margin-top:0">${g.sub ? g.sub.name : 'Club-wide'}</h2>`}
        <div class="panel"><ul class="list list-flush">${g.items.map(row)}</ul></div></section>`)}
  </div>`;
}

// ───────── One space ─────────
export function SpaceHome({ spaceId }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const space = useStore((s) => s.spaces.find((x) => x.id === spaceId));
  const content = useStore((s) => s.contents[spaceId]);
  useTitle(space?.name || 'Space');
  if (!space) return html`<div class="content"><${Empty} title="This space doesn’t exist">It may have been deleted.</${Empty}></div>`;
  if (!canSeeSpace(space, profile)) return html`<div class="content"><${NoAccess} space=${space} /></div>`;
  const editable = canEditSpace(space, profile);
  const treeList = content?.tree || [];
  const tree = nest(treeList);
  const folder = content?.driveFolder;
  const sub = subsidiaryById(space.subsidiaryId);
  const changeIcon = () => openIconPicker(space, async (look) => {
    try {
      await api.saveRef('spaces', { id: space.id, ...look });
      api.log(profile, 'space.edit', `Changed the icon of #${space.name}`, { type: 'space', id: space.id });
      toast('Icon changed.');
    } catch (e) { toastError(e); }
  });
  return html`<div class="content">
    ${sub && html`<div class="crumbs"><span>${sub.name}</span><${Icon} name="chevronRight" /><span>${space.name}</span></div>`}
    <div class="page-head">
      <div class="row" style="gap:12px;align-items:center">${isLead(profile)
        ? html`<button type="button" class="space-glyph lg glyph-btn" aria-label="Change the icon" title="Change the icon" onClick=${changeIcon}><${SpaceIcon} space=${space} size=${30} /></button>`
        : html`<span class="space-glyph lg"><${SpaceIcon} space=${space} size=${30} /></span>`}
        <div><h1>${space.name}</h1>${space.description && html`<p>${space.description}</p>`}</div></div>
      <div class="actions">
        ${editable && html`<button class="btn btn-primary" onClick=${() => openNewPage(space, null)}><${Icon} name="plus" />New page</button>`}
        <a class="btn" href=${href(`/s/${space.id}/board`)}><${Icon} name="board" />Task board</a>
        ${isAdmin(profile) && html`<button class="btn" onClick=${() => openSpaceAccess(space)}><${Icon} name="users" />Who can open it</button>`}
        ${isLead(profile) && html`<button class="btn btn-icon" aria-label="Space settings" title="Space settings" onClick=${() => openSpaceSettings(space)}><${Icon} name="sliders" /></button>`}
      </div>
    </div>
    ${space.private && html`<p class="small muted row" style="margin-top:-12px;gap:6px"><${Icon} name="lock" size=${15} />Private: only people an admin adds can open this space.</p>`}
    ${!editable && html`<p class="small muted" style="margin-top:${space.private ? '-6px' : '-12px'}">Leads edit the pages in this space.</p>`}
    <div class="space-layout">
      <div class="stack">
      <${SpaceTasks} space=${space} canEdit=${editable} />
      <section class="panel">
        <div class="panel-head"><h2>Pages</h2><span class="small muted">${treeList.length}</span></div>
        <div class="panel-body">${!content ? html`<${Loading} />` : tree.length ? html`<${PageTree} nodes=${tree} depth=${0} />` : html`<p class="muted" style="margin:6px 0">${editable ? 'No pages yet. Start with meeting notes or a how-to.' : 'No pages yet.'}</p>`}</div>
      </section>
      </div>
      <div class="stack">
      <${SpaceTeam} space=${space} />
      ${!subteamById(space.subteamId) && isLead(profile) && html`<section class="panel">
        <div class="panel-head"><h2>Link a subteam</h2></div>
        <div class="panel-body"><p class="muted" style="margin:4px 0 12px">Link this space to its subteam to show the team’s upcoming events, who’s working on it now and who’s on it.</p>
          <button class="btn" onClick=${() => openSpaceSettings(space)}><${Icon} name="sliders" />Space settings</button></div>
      </section>`}
      <section class="panel">
        <div class="panel-head"><h2>Google Drive folder</h2>${isLead(profile) && html`<button class="link-btn small" onClick=${() => openSpaceSettings(space)}>${folder ? 'Change' : 'Link a folder'}</button>`}</div>
        <div class="panel-body">${folder
          ? html`<${DriveBlock} file=${{ ...folder, mimeType: 'application/vnd.google-apps.folder', demo: folder.id?.startsWith('demo-') }} folder />`
          : html`<p class="muted" style="margin:6px 0">${isLead(profile) ? 'Link the shared Drive folder this team keeps its files in.' : 'No folder linked yet.'}</p>`}</div>
      </section>
      </div>
    </div>
  </div>`;
}

export function NoAccess({ space }) {
  return html`<${Empty} title=${`You can’t open #${space.name}`}>It’s a private space. Ask an admin to add you.</${Empty}>`;
}

function PageTree({ nodes, depth }) {
  return html`${nodes.map((n) => html`<div key=${n.id}>
    <a class="page-link" href=${href('/p/' + n.id)} style=${{ paddingLeft: 10 + depth * 20 + 'px' }}><${ItemIcon} icon=${n.icon} /><span>${n.title}</span></a>
    ${n.children.length > 0 && html`<${PageTree} nodes=${n.children} depth=${depth + 1} />`}
  </div>`)}`;
}

// ───────── One page ─────────
export function PageView({ pageId }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const route = useRoute();
  const [page, setPage] = useState(undefined);
  const [editing, setEditing] = useState(route.query.get('edit') === '1');
  useEffect(() => api.watchPage(pageId, setPage, () => setPage(null)), [api, pageId]);
  const space = useStore((s) => (page ? s.spaces.find((x) => x.id === page.spaceId) : null));
  useTitle(page?.title || 'Page');

  if (page === undefined) return html`<div class="content doc"><${Loading} /></div>`;
  if (page === null) return html`<div class="content doc"><${Empty} title="This page doesn’t exist">It may have been deleted or moved, or it’s in a private space you haven’t been added to.</${Empty}></div>`;
  if (space && !canSeeSpace(space, profile)) return html`<div class="content doc"><${NoAccess} space=${space} /></div>`;
  const editable = canEditSpace(space, profile);
  return editing && editable
    ? html`<${PageEditor} key=${page.id + ':edit'} page=${page} space=${space} onDone=${() => { setEditing(false); go('/p/' + page.id, { replace: true }); }} />`
    : html`<${PageReader} page=${page} space=${space} editable=${editable} onEdit=${() => setEditing(true)} />`;
}

function Breadcrumbs({ page, space }) {
  const tree = useTree(space?.id);
  const trail = space ? pathTo(tree, page.id).slice(0, -1) : [];
  const sub = subsidiaryById(space?.subsidiaryId);
  return html`<div class="crumbs">
    ${sub && html`<span>${sub.name}</span><${Icon} name="chevronRight" />`}
    ${space && html`<a href=${href('/s/' + space.id)} class="row" style="gap:4px"><${SpaceIcon} space=${space} size=${15} />${space.name}</a>`}
    ${trail.map((n) => html`<${Icon} name="chevronRight" key=${'i' + n.id} /><a key=${n.id} href=${href('/p/' + n.id)}>${n.title}</a>`)}
  </div>`;
}

function SubPages({ page, space, editable }) {
  const tree = useTree(space?.id);
  const kids = tree.filter((n) => n.parentId === page.id).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!kids.length && !editable) return null;
  return html`<div class="page-children">
    <div class="row" style="justify-content:space-between;margin-bottom:6px"><b class="small">Pages inside</b>
      ${editable && html`<button class="btn btn-sm btn-quiet" onClick=${() => openNewPage(space, page.id)}><${Icon} name="plus" />Add a page inside</button>`}</div>
    ${kids.map((n) => html`<a key=${n.id} class="page-link" href=${href('/p/' + n.id)}><${ItemIcon} icon=${n.icon} />${n.title}</a>`)}
    ${!kids.length && html`<p class="small muted" style="margin:0">None yet.</p>`}
  </div>`;
}

function PageReader({ page, space, editable, onEdit }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const tree = useTree(space?.id);
  const [busy, setBusy] = useState(false);
  const toggle = async (path) => {
    if (busy) return;
    setBusy(true);
    try { await api.savePageContent(page, toggleChecklist(page.content, path), profile); }
    catch (e) { if (e.code === 'conflict') toast('Someone just edited this page. Try again.', { kind: 'bad' }); else toastError(e); }
    setBusy(false);
  };
  const copyLink = async () => {
    const url = location.href.split('#')[0] + '#/p/' + page.id;
    try { await navigator.clipboard.writeText(url); toast('Link copied.'); } catch { toast(url); }
  };
  const remove = async () => {
    const count = descendants(tree, page.id).length - 1;
    if (!(await confirmDialog({ title: 'Delete this page?', body: `“${page.title}”${count ? ` and the ${count} page${count === 1 ? '' : 's'} inside it` : ''} will be deleted for everyone. This can’t be undone.`, confirmLabel: 'Delete page', danger: true }))) return;
    try {
      await api.deletePage(page);
      if (isLead(profile)) api.log(profile, 'page.delete', `Deleted page “${page.title}”${count ? ` and ${count} sub-pages` : ''} in ${space?.name}`, { type: 'page', id: page.id });
      toast('Page deleted.');
      go('/s/' + page.spaceId);
    } catch (e) { toastError(e, 'Only leads and the page’s creator can delete it.'); }
  };
  const canDelete = isLead(profile) || (editable && page.createdBy === profile.uid && descendants(tree, page.id).length === 1);
  const empty = !page.content?.blocks?.length;
  return html`<div class="content doc">
    <${Breadcrumbs} page=${page} space=${space} />
    <div class="doc-title">${page.icon && html`<span class="item-icon" aria-hidden="true" style="font-size:40px;padding:4px">${page.icon}</span>`}<h1>${page.title}</h1></div>
    <div class="doc-meta"><span title=${fmtDateTime(page.updatedAt)}>Edited ${relTime(page.updatedAt)} by ${page.updatedByName || 'a member'}</span></div>
    <div class="doc-toolbar">
      ${editable && html`<button class="btn btn-primary btn-sm" onClick=${onEdit}><${Icon} name="edit" />Edit page</button>`}
      <button class="btn btn-sm" onClick=${copyLink}><${Icon} name="link" />Copy link</button>
      <span class="spacer"></span>
      <${Menu} label="Page actions" items=${[
        editable && { label: 'Add a page inside', icon: 'plus', onClick: () => openNewPage(space, page.id) },
        editable && { label: 'Move', icon: 'folder', onClick: () => openMovePage(page, space) },
        canDelete && { label: 'Delete', icon: 'trash', danger: true, onClick: remove },
      ]} />
    </div>
    ${empty ? html`<div class="empty" style="padding:28px 0;text-align:left"><p style="margin:0">${editable ? 'This page is empty. Click Edit page to start writing.' : 'This page is empty.'}</p></div>`
      : html`<${BlocksView} content=${page.content} onToggleCheck=${editable ? toggle : null} />`}
    <${SubPages} page=${page} space=${space} editable=${editable} />
  </div>`;
}

function PageEditor({ page, space, onDone }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const rev = useRef(page.rev);
  const latest = useRef(null);
  const timer = useRef(null);
  const saving = useRef(Promise.resolve());
  const [state, setStateLocal] = useState('Saved');
  const [title, setTitle] = useState(page.title);
  const [icon, setIcon] = useState(page.icon || '');

  const doSave = () => {
    clearTimeout(timer.current);
    const content = latest.current;
    if (!content) return saving.current;
    latest.current = null;
    saving.current = saving.current.then(async () => {
      setStateLocal('Saving…');
      try {
        rev.current = await api.savePageContent({ ...page, rev: rev.current }, content, profile);
        setStateLocal('Saved');
      } catch (e) {
        if (e.code === 'conflict') {
          setStateLocal('Not saved');
          const overwrite = await confirmDialog({ title: 'Someone else edited this page', body: `${e.remote?.updatedByName || 'Another member'} saved changes while you were editing. Keep your version (theirs is replaced), or stop editing to see theirs.`, confirmLabel: 'Keep my version', cancelLabel: 'See their version' });
          if (overwrite) {
            rev.current = e.remote?.rev ?? rev.current;
            latest.current = content;
            return doSave();
          }
          onDone();
        } else { setStateLocal('Not saved'); toastError(e, 'Your changes weren’t saved. Check your connection.'); latest.current = latest.current || content; }
      }
    });
    return saving.current;
  };
  const schedule = (content) => { latest.current = content; setStateLocal('Unsaved changes'); clearTimeout(timer.current); timer.current = setTimeout(doSave, 1200); };
  useEffect(() => {
    const warn = (e) => { if (latest.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); if (latest.current) doSave(); };
  }, []);

  const saveMeta = async (patch) => {
    try { await saving.current; rev.current = await api.updatePageMeta({ ...page, rev: rev.current }, patch, profile); }
    catch (e) { toastError(e); }
  };
  const finish = async () => { await doSave(); if (title.trim() && title.trim() !== page.title) await saveMeta({ title: title.trim() }); onDone(); };

  return html`<div class="content doc">
    <${Breadcrumbs} page=${page} space=${space} />
    <div class="doc-title">
      <button class="emoji-btn" aria-label="Change icon" title="Change icon" onClick=${() => openModal((close) => html`<${EmojiPicker} onClose=${close} onPick=${(e) => { setIcon(e); saveMeta({ icon: e }); }} />`)}>${icon || html`<${Icon} name="page" size=${26} />`}</button>
      <input value=${title} maxlength="200" aria-label="Page title" placeholder="Untitled"
        onInput=${(e) => setTitle(e.target.value)} onBlur=${() => { if (title.trim() && title.trim() !== page.title) saveMeta({ title: title.trim() }); }}
        onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }} />
    </div>
    <div class="doc-toolbar">
      <button class="btn btn-primary btn-sm" onClick=${finish}><${Icon} name="check" />Done</button>
      <span class=${'save-state' + (state === 'Not saved' ? ' bad' : '')} aria-live="polite">${state}</span>
      <span class="spacer"></span>
      <span class="tiny muted">Press Tab or click + for headings, checklists, tables, callouts and Google Drive files.</span>
    </div>
    <${EditorHost} content=${page.content} onChange=${schedule} />
  </div>`;
}

// ───────── Dialogs ─────────
function openNewPage(space, parentId) { openModal((close) => html`<${NewPage} space=${space} parentId=${parentId} close=${close} />`); }
function NewPage({ space, parentId, close }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState('');
  const [busy, setBusy] = useState(false);
  const parent = treeOf(space.id).find((n) => n.id === parentId);
  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const id = await api.createPage(space.id, { title: title.trim(), icon, parentId: parentId || null }, profile);
      close();
      go(`/p/${id}?edit=1`);
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<${Modal} title="New page" onClose=${close}
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${create} disabled=${busy || !title.trim()}>Create page</button>`}>
    <p class="small muted" style="margin-top:0">In #${space.name}${parent ? `, inside “${parent.title}”` : ''}.</p>
    <div class="row" style="align-items:flex-end">
      <button class="btn btn-icon" style="font-size:20px" aria-label="Choose icon" onClick=${() => openModal((c) => html`<${EmojiPicker} onClose=${c} onPick=${setIcon} />`)}>${icon || html`<${Icon} name="page" />`}</button>
      <${Field} label="Title"><input class="input" value=${title} maxlength="200" placeholder="Meeting notes, How to wire a thruster…" onInput=${(e) => setTitle(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && create()} /></${Field}>
    </div>
  </${Modal}>`;
}

function openMovePage(page, space) { openModal((close) => html`<${MovePage} page=${page} space=${space} close=${close} />`); }
function MovePage({ page, space, close }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const tree = treeOf(space.id);
  const blocked = new Set(descendants(tree, page.id));
  const options = tree.filter((n) => !blocked.has(n.id));
  const [parentId, setParentId] = useState(page.parentId || '');
  const save = async () => {
    try { await api.updatePageMeta(page, { parentId: parentId || null }, profile); toast('Page moved.'); close(); } catch (e) { toastError(e); }
  };
  return html`<${Modal} title="Move page" onClose=${close}
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save}>Move</button>`}>
    <${Field} label=${`Put “${page.title}” inside`}><select class="select" value=${parentId} onChange=${(e) => setParentId(e.target.value)}>
      <option value="">Top level of ${space.name}</option>${options.map((n) => html`<option value=${n.id} key=${n.id}>${n.icon ? n.icon + ' ' : ''}${n.title}</option>`)}</select></${Field}>
  </${Modal}>`;
}

export function openSpaceSettings(space) { openModal((close) => html`<${SpaceSettings} space=${space} close=${close} />`); }
export function openNewSpace(preset = {}) { openModal((close) => html`<${SpaceSettings} space=${null} preset=${preset} close=${close} />`); }

// Leads edit a space's name, description, editing and Drive folder. Admins also choose its
// subsidiary, its subteam and whether it's private.
export function SpaceSettings({ space, preset = {}, close }) {
  const { api, profile, subsidiaries, subteams } = useStore((s) => ({ api: s.api, profile: s.profile, subsidiaries: s.subsidiaries, subteams: s.subteams }));
  const content = useStore((s) => (space ? s.contents[space.id] : null));
  const admin = isAdmin(profile);
  const isNew = !space;
  const [f, setF] = useState({
    name: space?.name || '', description: space?.description || '', memberEdit: space ? !!space.memberEdit : true,
    subsidiaryId: space ? (space.subsidiaryId || '') : (preset.subsidiaryId || ''), subteamId: space?.subteamId || '',
    private: space ? !!space.private : false, driveFolder: content?.driveFolder || null,
    icon: space?.icon || '', iconImage: space?.iconImage || null,
  });
  const pickIcon = () => openIconPicker({ ...f, name: f.name.trim() }, (look) => setF((cur) => ({ ...cur, ...look })));
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pickFolder = async () => { try { const [folder] = await pickFromDrive({ folders: true }); if (folder) setF({ ...f, driveFolder: { id: folder.id, name: folder.name, url: folder.url } }); } catch (e) { toastError(e); } };
  const useLink = () => {
    const file = parseDriveLink(link);
    if (!file || file.mimeType !== 'application/vnd.google-apps.folder') { setErr('Paste a link to a Google Drive folder (it contains /folders/).'); return; }
    setF({ ...f, driveFolder: { id: file.id, name: 'Drive folder', url: file.url } }); setLink(''); setErr('');
  };
  const teamChoices = subteams.filter((t) => (t.subsidiaryId || '') === f.subsidiaryId);
  const save = async () => {
    const name = f.name.trim();
    if (!name) return setErr('Name the space.');
    setBusy(true);
    try {
      const meta = { name, description: f.description.trim(), memberEdit: f.memberEdit, icon: f.icon, iconImage: f.iconImage };
      const grouping = { subsidiaryId: f.subsidiaryId || null, subteamId: f.subteamId || null, private: f.private };
      let id = space?.id;
      if (isNew) id = await api.createSpace({ ...meta, ...grouping, order: getState().spaces.length + 1 }, { driveFolder: f.driveFolder });
      else {
        await api.saveRef('spaces', { id, ...meta, ...(admin ? grouping : {}) });
        if ((f.driveFolder?.id || null) !== (content?.driveFolder?.id || null)) await api.saveSpaceContent(id, { driveFolder: f.driveFolder });
      }
      api.log(profile, isNew ? 'space.add' : 'space.edit', `${isNew ? 'Created' : 'Updated'} space #${name}${f.private ? ' (private)' : ''}`, { type: 'space', id });
      toast(isNew ? 'Space created.' : 'Space saved.');
      close();
      if (isNew && f.private) openSpaceAccess({ id, name, private: true, subteamId: f.subteamId || null });
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<${Modal} title=${isNew ? 'New space' : `#${space.name} settings`} onClose=${close} wide
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>${isNew ? 'Create space' : 'Save'}</button>`}>
    <div class="form-grid">
      <div class="field"><span id="sp-name">Name and icon</span>
        <div class="name-row">
          <button type="button" class="icon-pick" aria-label="Change the icon" title="Change the icon" onClick=${pickIcon}><${SpaceIcon} space=${f} size=${22} /></button>
          <input class="input" aria-labelledby="sp-name" value=${f.name} maxlength="60" placeholder="chassis" onInput=${(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <small>Short and lowercase reads best, like a Discord channel: chassis, controls-systems. The icon can be an emoji or a picture.</small></div>
      ${admin ? html`<${Field} label="Subsidiary"><select class="select" value=${f.subsidiaryId} onChange=${(e) => setF({ ...f, subsidiaryId: e.target.value, subteamId: '' })}>
          <option value="">None (club-wide)</option>${subsidiaries.map((x) => html`<option value=${x.id} key=${x.id}>${x.name}</option>`)}</select></${Field}>`
        : html`<div></div>`}
      <${Field} label="Description" full><input class="input" value=${f.description} maxlength="200" onInput=${(e) => setF({ ...f, description: e.target.value })} /></${Field}>
      ${admin && html`<${Field} label="Subteam (optional)" hint="Its members are suggested when you add people to a private space.">
        <select class="select" value=${f.subteamId} onChange=${(e) => setF({ ...f, subteamId: e.target.value })}>
          <option value="">None</option>${teamChoices.map((t) => html`<option value=${t.id} key=${t.id}>${t.name}</option>`)}</select></${Field}>`}
      ${admin && html`<div class="field" role="radiogroup" aria-label="Who can open it"><span aria-hidden="true">Who can open it</span>
        <label class="check"><input type="radio" name="sp-private" checked=${!f.private} onChange=${() => setF({ ...f, private: false })} /><span>Every member</span></label>
        <label class="check"><input type="radio" name="sp-private" checked=${f.private} onChange=${() => setF({ ...f, private: true })} /><span>Only people you add (private)</span></label></div>`}
      <label class="check full"><input type="checkbox" checked=${f.memberEdit} onChange=${(e) => setF({ ...f, memberEdit: e.target.checked })} />
        <span>Everyone who can open it can add and edit pages and tasks<br /><span class="small muted">Turn off for spaces only leads should change, like officer docs.</span></span></label>
      <div class="field full"><span>Google Drive folder</span>
        ${f.driveFolder ? html`<div class="row"><span class="chip"><${Icon} name="folder" size=${14} />${f.driveFolder.name || 'Drive folder'}</span><button class="link-btn small" onClick=${() => setF({ ...f, driveFolder: null })}>Remove</button></div>`
        : html`<div class="row wrap">${driveConfigured() && html`<button class="btn btn-sm" type="button" onClick=${pickFolder}><${Icon} name="cloud" />Choose from Google Drive</button>`}
            <input class="input" style="flex:1;min-width:220px" value=${link} placeholder="Or paste a Drive folder link" onInput=${(e) => setLink(e.target.value)} />
            <button class="btn btn-sm" type="button" onClick=${useLink}>Use link</button></div>`}
        <small>Members see the folder’s files right in the space. Share the folder with the club in Google Drive so everyone can open it.</small></div>
    </div>
    ${err && html`<p class="form-error" role="alert">${err}</p>`}
  </${Modal}>`;
}

// ───────── Who can open a space (admins) ─────────
export function openSpaceAccess(space) { openModal((close) => html`<${SpaceAccess} space=${space} close=${close} />`); }
function SpaceAccess({ space, close }) {
  const { api, profile, subteams } = useStore((s) => ({ api: s.api, profile: s.profile, subteams: s.subteams }));
  const live = useStore((s) => s.spaces.find((x) => x.id === space.id)) || space;
  const res = useAsync(() => api.listMembers(), [api]);
  const people = (res.data || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const [isPrivate, setPrivate] = useState(!!live.private);
  const [chosen, setChosen] = useState(null); // Set of uids, once members load
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (res.data && !chosen) setChosen(new Set(res.data.filter((m) => (m.spaces || []).includes(space.id)).map((m) => m.uid))); }, [res.data]);
  const team = subteamById(live.subteamId);
  const addTeam = (teamId) => setChosen(new Set([...chosen, ...people.filter((m) => (m.subteams || []).includes(teamId)).map((m) => m.uid)]));
  const flip = (uid) => { const next = new Set(chosen); next.has(uid) ? next.delete(uid) : next.add(uid); setChosen(next); };
  const shown = people.filter((m) => !q || `${m.name} ${m.email}`.toLowerCase().includes(q.toLowerCase()));
  const save = async () => {
    setBusy(true);
    try {
      const changes = {};
      for (const m of people) {
        const has = (m.spaces || []).includes(space.id), want = chosen.has(m.uid);
        if (has !== want) changes[m.uid] = want ? [...(m.spaces || []), space.id] : (m.spaces || []).filter((x) => x !== space.id);
      }
      if (Object.keys(changes).length) await api.setSpaceAccess(changes);
      if (isPrivate !== !!live.private) await api.saveRef('spaces', { id: space.id, private: isPrivate });
      const n = Object.keys(changes).length;
      api.log(profile, 'space.access', `#${live.name}: ${isPrivate ? 'private' : 'open to every member'}${n ? `, changed access for ${n} ${n === 1 ? 'person' : 'people'}` : ''}`, { type: 'space', id: space.id });
      setState({ membersCache: null }); bump();
      toast('Access saved.');
      close();
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<${Modal} title=${`Who can open #${live.name}`} onClose=${close} wide
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy || !chosen}>Save</button>`}>
    <div class="stack">
      <div class="field" role="radiogroup" aria-label="Access"><span aria-hidden="true">Access</span>
        <label class="check"><input type="radio" name="acc" checked=${!isPrivate} onChange=${() => setPrivate(false)} /><span>Every member</span></label>
        <label class="check"><input type="radio" name="acc" checked=${isPrivate} onChange=${() => setPrivate(true)} /><span>Only the people checked below (private)<br /><span class="small muted">Admins can always open it.</span></span></label></div>
      ${isPrivate && (!chosen ? html`<${Loading} />` : html`<div class="stack" style="gap:10px">
        <div class="row wrap" style="gap:8px">
          <div class="search" style="flex:1;min-width:200px"><${Icon} name="search" /><input class="input" type="search" placeholder="Find a member" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
          ${team && html`<button class="btn btn-sm" type="button" onClick=${() => addTeam(team.id)}><${Icon} name="plus" />Add everyone in ${subteamLabel(team)}</button>`}
          <select class="select" style="width:auto" aria-label="Add a whole subteam" value="" onChange=${(e) => e.target.value && addTeam(e.target.value)}>
            <option value="">Add a subteam…</option>${subteams.map((t) => html`<option value=${t.id} key=${t.id}>${subteamLabel(t)}</option>`)}</select>
        </div>
        <p class="small muted" style="margin:0">${chosen.size} ${chosen.size === 1 ? 'person' : 'people'} added.</p>
        <ul class="list list-flush pick-list">${shown.map((m) => html`<li key=${m.uid}>
          <label class="check" style="flex:1"><input type="checkbox" checked=${m.role === 'admin' || chosen.has(m.uid)} disabled=${m.role === 'admin'} onChange=${() => flip(m.uid)} />
            <${Avatar} person=${m} size=${26} /><span><b>${m.name}</b> <span class="small muted">${m.role === 'admin' ? 'Admin: can always open it' : (m.subteams || []).map(subteamLabel).filter(Boolean).join(', ')}</span></span></label></li>`)}</ul>
      </div>`)}
    </div>
  </${Modal}>`;
}
