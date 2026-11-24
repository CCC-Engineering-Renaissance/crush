// Announcements: leads post, everyone reads. Pinned posts stay on top.
import { html, useState, useEffect, Icon, Avatar, Modal, openModal, Field, Chip, Menu, Loading, Empty, toast, toastError, confirmDialog } from '../lib/ui.js';
import { useStore, isLead, subteamById } from '../lib/store.js';
import { relTime, fmtDateTime } from '../lib/time.js';
import { Markdown } from '../lib/text.js';
import { seriesColor } from './charts.js';
import { useTitle } from './common.js';

export function Announcements() {
  useTitle('Announcements');
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const lead = isLead(profile);
  const [items, setItems] = useState(null);
  const [mineOnly, setMineOnly] = useState(false);
  useEffect(() => api.watchAnnouncements(setItems, (e) => { setItems([]); toastError(e); }), [api]);
  const list = (items || [])
    .filter((a) => !mineOnly || !a.subteams?.length || a.subteams.some((s) => profile.subteams?.includes(s)))
    .sort((a, b) => (b.pinned - a.pinned) || (new Date(b.createdAt) - new Date(a.createdAt)));
  return html`<div class="content doc">
    <div class="page-head">
      <div><h1>Announcements</h1><p>News from officers and leads.</p></div>
      <div class="actions">
        <label class="check small"><input type="checkbox" checked=${mineOnly} onChange=${(e) => setMineOnly(e.target.checked)} />Only for my subteams</label>
        ${lead && html`<button class="btn btn-primary" onClick=${() => openEditor(null)}><${Icon} name="plus" />New announcement</button>`}
      </div>
    </div>
    ${!items ? html`<${Loading} />` : !list.length ? html`<div class="panel"><${Empty} title="No announcements yet">${lead ? 'Post the first one for the club.' : 'Officers post news here.'}</${Empty}></div>`
    : html`<div class="stack">${list.map((a) => html`<${Post} key=${a.id} a=${a} />`)}</div>`}
  </div>`;
}

function Post({ a }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const lead = isLead(profile);
  const togglePin = async () => { try { await api.saveAnnouncement({ id: a.id, title: a.title, body: a.body, pinned: !a.pinned }, profile); toast(a.pinned ? 'Unpinned.' : 'Pinned to the top.'); } catch (e) { toastError(e); } };
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Delete this announcement?', body: `“${a.title}” will be removed for everyone.`, confirmLabel: 'Delete', danger: true }))) return;
    try { await api.deleteAnnouncement(a.id); api.log(profile, 'announcement.delete', `Deleted announcement “${a.title}”`, { type: 'announcement', id: a.id }); toast('Announcement deleted.'); } catch (e) { toastError(e); }
  };
  return html`<article class="panel panel-pad" aria-labelledby=${'an-' + a.id}>
    <div class="row" style="align-items:flex-start">
      <${Avatar} person=${{ uid: a.authorUid, name: a.authorName, photoURL: a.authorPhoto }} size=${36} />
      <div class="grow" style="min-width:0;flex:1">
        <div class="row wrap" style="gap:8px">${a.pinned && html`<span class="badge badge-info"><${Icon} name="pin" size=${12} />Pinned</span>`}
          <h2 id=${'an-' + a.id} style="margin:0;font-size:18px">${a.title}</h2></div>
        <div class="small muted" title=${fmtDateTime(a.createdAt)}>${a.authorName}, ${relTime(a.createdAt)}
          ${a.subteams?.length > 0 && html` for ${a.subteams.map((id) => subteamById(id)?.name).filter(Boolean).join(', ')}`}</div>
      </div>
      ${lead && html`<${Menu} label="Announcement actions" items=${[
        { label: a.pinned ? 'Unpin' : 'Pin to top', icon: 'pin', onClick: togglePin },
        { label: 'Edit', icon: 'edit', onClick: () => openEditor(a) },
        { label: 'Delete', icon: 'trash', danger: true, onClick: remove },
      ]} />`}
    </div>
    <div style="margin-top:12px"><${Markdown} text=${a.body} /></div>
    ${a.subteams?.length > 0 && html`<div class="chips">${a.subteams.map((id) => subteamById(id) && html`<${Chip} key=${id} color=${seriesColor(subteamById(id).color)}>${subteamById(id).name}</${Chip}>`)}</div>`}
  </article>`;
}

function openEditor(a) { openModal((close) => html`<${Editor} a=${a} close=${close} />`); }
function Editor({ a, close }) {
  const { api, profile, subteams } = useStore((s) => ({ api: s.api, profile: s.profile, subteams: s.subteams }));
  const [f, setF] = useState({ title: a?.title || '', body: a?.body || '', subteams: a?.subteams || [], pinned: !!a?.pinned });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    if (!f.title.trim()) return setErr('Add a title.');
    setBusy(true);
    try {
      await api.saveAnnouncement({ ...(a ? { id: a.id } : {}), title: f.title.trim(), body: f.body.trim(), subteams: f.subteams, pinned: f.pinned }, profile);
      api.log(profile, a ? 'announcement.edit' : 'announcement.add', `${a ? 'Edited' : 'Posted'} “${f.title.trim()}”`, { type: 'announcement', id: a?.id });
      toast(a ? 'Announcement saved.' : 'Posted.');
      close();
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<${Modal} title=${a ? 'Edit announcement' : 'New announcement'} onClose=${close} wide
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>${a ? 'Save' : 'Post'}</button>`}>
    <div class="stack">
      <${Field} label="Title"><input class="input" value=${f.title} maxlength="160" onInput=${(e) => setF({ ...f, title: e.target.value })} /></${Field}>
      <${Field} label="Message" hint="Supports **bold**, *italic*, links and lists that start with a dash."><textarea class="textarea" style="min-height:180px" value=${f.body} maxlength="8000" onInput=${(e) => setF({ ...f, body: e.target.value })}></textarea></${Field}>
      <div class="field"><span>Who is it for?</span><div class="chips">
        <button type="button" class="chip chip-toggle" aria-pressed=${String(!f.subteams.length)} onClick=${() => setF({ ...f, subteams: [] })}>Everyone</button>
        ${subteams.map((s) => html`<button type="button" key=${s.id} class="chip chip-toggle" aria-pressed=${String(f.subteams.includes(s.id))}
          onClick=${() => setF({ ...f, subteams: f.subteams.includes(s.id) ? f.subteams.filter((x) => x !== s.id) : [...f.subteams, s.id] })}>${s.name}</button>`)}</div></div>
      <label class="check"><input type="checkbox" checked=${f.pinned} onChange=${(e) => setF({ ...f, pinned: e.target.checked })} />Pin to the top</label>
      ${err && html`<p class="form-error" role="alert">${err}</p>`}
    </div>
  </${Modal}>`;
}
