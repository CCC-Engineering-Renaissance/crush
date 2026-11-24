// Spaces and pages: a Notion-style tree of pages per space, each space with a Drive folder and a task board.
import { html, useState, useEffect, useRef, useMemo, Icon, Modal, openModal, Field, Menu, Loading, Empty, Notice, toast, toastError, confirmDialog, EmojiPicker, ItemIcon } from '../lib/ui.js';
import { useStore, isLead, isAdmin, getState } from '../lib/store.js';
import { useRoute, href, go } from '../lib/router.js';
import { relTime, fmtDateTime } from '../lib/time.js';
import { nest, pathTo, descendants } from '../data/tree.js';
import { BlocksView, EditorHost, DriveBlock, toggleChecklist } from './editor.js';
import { driveConfigured, pickFromDrive, parseDriveLink } from '../google/drive.js';
import { seriesColor, PALETTE_KEYS } from './charts.js';
import { useTitle } from './common.js';

const canEditSpace = (space, profile) => isLead(profile) || !!space?.memberEdit;

// ───────── All spaces ─────────
export function SpacesIndex() {
  useTitle('Spaces');
  const { spaces, profile } = useStore((s) => ({ spaces: s.spaces, profile: s.profile }));
  return html`<div class="content">
    <div class="page-head"><div><h1>Spaces</h1><p>Each space holds pages, a task board and a Google Drive folder.</p></div>
      ${isAdmin(profile) && html`<div class="actions"><a class="btn" href="#/admin/spaces"><${Icon} name="plus" />Add a space</a></div>`}</div>
    ${!spaces.length ? html`<div class="panel"><${Empty} title="No spaces yet">${isAdmin(profile) ? 'Create spaces in Admin, or add the starter set.' : 'An admin sets these up.'}</${Empty}></div>`
    : html`<div class="panel"><ul class="list list-flush">${spaces.map((s) => html`<li key=${s.id} style="align-items:center">
        <span style="width:36px;text-align:center"><${ItemIcon} icon=${s.icon} kind="space" size=${26} /></span>
        <span class="grow"><a class="title" href=${href('/s/' + s.id)}>${s.name}</a><div class="meta">${s.description || ''}</div></span>
        <span class="small muted nowrap">${(s.tree || []).length} pages</span>
        <a class="btn btn-sm" href=${href(`/s/${s.id}/board`)}><${Icon} name="board" />Board</a>
      </li>`)}</ul></div>`}
  </div>`;
}

// ───────── One space ─────────
export function SpaceHome({ spaceId }) {
  const { profile } = useStore((s) => ({ profile: s.profile }));
  const space = useStore((s) => s.spaces.find((x) => x.id === spaceId));
  useTitle(space?.name || 'Space');
  if (!space) return html`<div class="content"><${Empty} title="This space doesn’t exist">It may have been deleted.</${Empty}></div>`;
  const editable = canEditSpace(space, profile);
  const tree = nest(space.tree || []);
  return html`<div class="content">
    <div class="page-head">
      <div class="row" style="gap:14px;align-items:center"><${ItemIcon} icon=${space.icon} kind="space" size=${44} />
        <div><h1>${space.name}</h1>${space.description && html`<p>${space.description}</p>`}</div></div>
      <div class="actions">
        ${editable && html`<button class="btn btn-primary" onClick=${() => openNewPage(space, null)}><${Icon} name="plus" />New page</button>`}
        <a class="btn" href=${href(`/s/${space.id}/board`)}><${Icon} name="board" />Task board</a>
        ${isLead(profile) && html`<button class="btn btn-icon" aria-label="Space settings" title="Space settings" onClick=${() => openSpaceSettings(space)}><${Icon} name="sliders" /></button>`}
      </div>
    </div>
    ${!editable && html`<p class="small muted" style="margin-top:-12px">Leads edit the pages in this space.</p>`}
    <div class="grid-2" style="align-items:start">
      <section class="panel">
        <div class="panel-head"><h2>Pages</h2><span class="small muted">${(space.tree || []).length}</span></div>
        <div class="panel-body">${tree.length ? html`<${PageTree} nodes=${tree} depth=${0} />` : html`<p class="muted" style="margin:6px 0">${editable ? 'No pages yet. Start with meeting notes or a how-to.' : 'No pages yet.'}</p>`}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Google Drive folder</h2>${isLead(profile) && html`<button class="link-btn small" onClick=${() => openSpaceSettings(space)}>${space.driveFolder ? 'Change' : 'Link a folder'}</button>`}</div>
        <div class="panel-body">${space.driveFolder
          ? html`<${DriveBlock} file=${{ ...space.driveFolder, mimeType: 'application/vnd.google-apps.folder', demo: space.driveFolder.id?.startsWith('demo-') }} folder />`
          : html`<p class="muted" style="margin:6px 0">${isLead(profile) ? 'Link the shared Drive folder this team keeps its files in.' : 'No folder linked yet.'}</p>`}</div>
      </section>
    </div>
  </div>`;
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
  if (page === null) return html`<div class="content doc"><${Empty} title="This page doesn’t exist">It may have been deleted or moved.</${Empty}></div>`;
  const editable = canEditSpace(space, profile);
  return editing && editable
    ? html`<${PageEditor} key=${page.id + ':edit'} page=${page} space=${space} onDone=${() => { setEditing(false); go('/p/' + page.id, { replace: true }); }} />`
    : html`<${PageReader} page=${page} space=${space} editable=${editable} onEdit=${() => setEditing(true)} />`;
}

function Breadcrumbs({ page, space }) {
  const trail = space ? pathTo(space.tree || [], page.id).slice(0, -1) : [];
  return html`<div class="crumbs">
    ${space && html`<a href=${href('/s/' + space.id)}>${space.icon} ${space.name}</a>`}
    ${trail.map((n) => html`<${Icon} name="chevronRight" key=${'i' + n.id} /><a key=${n.id} href=${href('/p/' + n.id)}>${n.title}</a>`)}
  </div>`;
}

function SubPages({ page, space, editable }) {
  const kids = (space?.tree || []).filter((n) => n.parentId === page.id).sort((a, b) => (a.order || 0) - (b.order || 0));
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
    const count = descendants(space?.tree || [], page.id).length - 1;
    if (!(await confirmDialog({ title: 'Delete this page?', body: `“${page.title}”${count ? ` and the ${count} page${count === 1 ? '' : 's'} inside it` : ''} will be deleted for everyone. This can’t be undone.`, confirmLabel: 'Delete page', danger: true }))) return;
    try {
      await api.deletePage(page);
      if (isLead(profile)) api.log(profile, 'page.delete', `Deleted page “${page.title}”${count ? ` and ${count} sub-pages` : ''} in ${space?.name}`, { type: 'page', id: page.id });
      toast('Page deleted.');
      go('/s/' + page.spaceId);
    } catch (e) { toastError(e, 'Only leads and the page’s creator can delete it.'); }
  };
  const canDelete = isLead(profile) || (editable && page.createdBy === profile.uid && descendants(space?.tree || [], page.id).length === 1);
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
  const parent = (space.tree || []).find((n) => n.id === parentId);
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
    <p class="small muted" style="margin-top:0">In ${space.icon ? space.icon + ' ' : ''}${space.name}${parent ? `, inside “${parent.title}”` : ''}.</p>
    <div class="row" style="align-items:flex-end">
      <button class="btn btn-icon" style="font-size:20px" aria-label="Choose icon" onClick=${() => openModal((c) => html`<${EmojiPicker} onClose=${c} onPick=${setIcon} />`)}>${icon || html`<${Icon} name="page" />`}</button>
      <${Field} label="Title"><input class="input" value=${title} maxlength="200" placeholder="Meeting notes, How to wire a thruster…" onInput=${(e) => setTitle(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && create()} /></${Field}>
    </div>
  </${Modal}>`;
}

function openMovePage(page, space) { openModal((close) => html`<${MovePage} page=${page} space=${space} close=${close} />`); }
function MovePage({ page, space, close }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const blocked = new Set(descendants(space.tree || [], page.id));
  const options = (space.tree || []).filter((n) => !blocked.has(n.id));
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
export function SpaceSettings({ space, close }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const isNew = !space;
  const [f, setF] = useState({ name: space?.name || '', icon: space?.icon || '📁', color: space?.color || 'sky', description: space?.description || '', memberEdit: space ? !!space.memberEdit : true, driveFolder: space?.driveFolder || null });
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const pickFolder = async () => { try { const [folder] = await pickFromDrive({ folders: true }); if (folder) setF({ ...f, driveFolder: { id: folder.id, name: folder.name, url: folder.url } }); } catch (e) { toastError(e); } };
  const useLink = () => {
    const file = parseDriveLink(link);
    if (!file || file.mimeType !== 'application/vnd.google-apps.folder') { setErr('Paste a link to a Google Drive folder (it contains /folders/).'); return; }
    setF({ ...f, driveFolder: { id: file.id, name: 'Drive folder', url: file.url } }); setLink(''); setErr('');
  };
  const save = async () => {
    if (!f.name.trim()) return setErr('Name the space.');
    setBusy(true);
    try {
      const data = { name: f.name.trim(), icon: f.icon, color: f.color, description: f.description.trim(), memberEdit: f.memberEdit, driveFolder: f.driveFolder };
      if (isNew) await api.saveRef('spaces', { ...data, order: getState().spaces.length + 1, tree: [] });
      else await api.saveRef('spaces', { id: space.id, ...data });
      api.log(profile, isNew ? 'space.add' : 'space.edit', `${isNew ? 'Created' : 'Updated'} space “${data.name}”`, { type: 'space', id: space?.id });
      toast(isNew ? 'Space created.' : 'Space saved.');
      close();
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<${Modal} title=${isNew ? 'New space' : 'Space settings'} onClose=${close} wide
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>${isNew ? 'Create space' : 'Save'}</button>`}>
    <div class="form-grid">
      <div class="field full"><span>Name and icon</span><div class="row">
        <button class="btn btn-icon" style="font-size:20px" aria-label="Choose icon" onClick=${() => openModal((c) => html`<${EmojiPicker} onClose=${c} onPick=${(e) => setF({ ...f, icon: e })} />`)}>${f.icon || html`<${Icon} name="folder" />`}</button>
        <input class="input" value=${f.name} maxlength="60" placeholder="Crush Depth" onInput=${(e) => setF({ ...f, name: e.target.value })} /></div></div>
      <${Field} label="Description" full><input class="input" value=${f.description} maxlength="200" onInput=${(e) => setF({ ...f, description: e.target.value })} /></${Field}>
      <div class="field full"><span>Color</span><div class="chips">${PALETTE_KEYS.map((k) => html`<button type="button" key=${k} class="chip chip-toggle" aria-pressed=${String(f.color === k)} onClick=${() => setF({ ...f, color: k })}><i style=${{ background: seriesColor(k) }}></i>${k[0].toUpperCase() + k.slice(1)}</button>`)}</div></div>
      <label class="check full"><input type="checkbox" checked=${f.memberEdit} onChange=${(e) => setF({ ...f, memberEdit: e.target.checked })} />
        <span>Every member can add and edit pages and tasks here<br /><span class="small muted">Turn off for spaces only leads should change, like officer docs.</span></span></label>
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
