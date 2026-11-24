// Admin: approve members, roles, invites, subteams, activities, spaces, settings and the audit log.
import { html, useState, useEffect, useMemo, Icon, Avatar, Modal, openModal, Field, Chip, Menu, Loading, Empty, Notice, useAsync, toast, toastError, confirmDialog } from '../lib/ui.js';
import { useStore, setState, getState, isAdmin, subteamById, bump, DEFAULT_SETTINGS } from '../lib/store.js';
import { href, go } from '../lib/router.js';
import { relTime, fmtDateTime } from '../lib/time.js';
import { seriesColor, PALETTE_KEYS } from './charts.js';
import { SpaceSettings, openSpaceSettings } from './spaces.js';
import { useTitle } from './common.js';

const TABS = [['members', 'Members'], ['invites', 'Invites'], ['subteams', 'Subteams'], ['activities', 'Activities'], ['spaces', 'Spaces'], ['settings', 'Settings'], ['audit', 'Audit log']];
const ROLE = { admin: 'Admin', lead: 'Lead', member: 'Member' };
const STATUS = { active: 'Active', pending: 'Waiting for approval', inactive: 'Inactive (alumni)', denied: 'Not approved' };

export function Admin({ tab }) {
  useTitle('Admin');
  const { pendingMembers, subteams, settingsSaved } = useStore((s) => ({ pendingMembers: s.pendingMembers, subteams: s.subteams, settingsSaved: s.settingsSaved }));
  const t = TABS.find(([k]) => k === tab) ? tab : 'members';
  return html`<div class="content wide">
    <div class="page-head"><div><h1>Admin</h1><p>Who gets in, what they can do, and how the club is set up.</p></div></div>
    ${!subteams.length && html`<${StarterContent} settingsSaved=${settingsSaved} />`}
    <nav class="tabs" aria-label="Admin sections">${TABS.map(([k, l]) => html`<a key=${k} href=${href('/admin/' + k)} aria-current=${t === k ? 'page' : undefined}>${l}${k === 'members' && pendingMembers.length ? html`<span class="badge badge-warn">${pendingMembers.length}</span>` : ''}</a>`)}</nav>
    ${t === 'members' && html`<${MembersAdmin} />`}
    ${t === 'invites' && html`<${InvitesAdmin} />`}
    ${t === 'subteams' && html`<${SubteamsAdmin} />`}
    ${t === 'activities' && html`<${ActivitiesAdmin} />`}
    ${t === 'spaces' && html`<${SpacesAdmin} />`}
    ${t === 'settings' && html`<${SettingsAdmin} />`}
    ${t === 'audit' && html`<${AuditAdmin} />`}
  </div>`;
}

// ───────── First run ─────────
const STARTER = {
  subteams: {
    mechanical: { name: 'Mechanical', color: 'lime', order: 1 },
    electrical: { name: 'Electrical & Software', color: 'sky', order: 2 },
    media: { name: 'Media', color: 'orange', order: 3 },
    business: { name: 'Business', color: 'navy', order: 4 },
  },
  activities: {
    meeting: { name: 'General meeting', subteamId: null, order: 1 },
    build: { name: 'ROV build & fabrication', subteamId: 'mechanical', order: 2 },
    cad: { name: 'CAD & design', subteamId: 'mechanical', order: 3 },
    wiring: { name: 'Electronics & wiring', subteamId: 'electrical', order: 4 },
    code: { name: 'Software & controls', subteamId: 'electrical', order: 5 },
    pool: { name: 'Pool test', subteamId: null, order: 6 },
    docs: { name: 'Technical documentation', subteamId: null, order: 7 },
    media: { name: 'Photo, video & social', subteamId: 'media', order: 8 },
    sponsors: { name: 'Fundraising & sponsors', subteamId: 'business', order: 9 },
    outreach: { name: 'Outreach event', subteamId: null, order: 10 },
    intro: { name: 'Intro projects', subteamId: null, order: 11 },
  },
  spaces: {
    club: { name: 'Club HQ', icon: '🐂', color: 'navy', order: 1, memberEdit: false, description: 'How the club runs: onboarding, safety, meeting notes and officer docs.', driveFolder: null, tree: [] },
    crush: { name: 'Crush Depth', icon: '🌊', color: 'sky', order: 2, memberEdit: true, description: 'The MATE ROV competition team: season plan, design log and pool tests.', driveFolder: null, tree: [] },
    mechanical: { name: 'Mechanical', icon: '⚙️', color: 'lime', order: 3, memberEdit: true, description: 'Frame, thrusters, manipulators and machining.', driveFolder: null, tree: [] },
    electrical: { name: 'Electrical & Software', icon: '⚡', color: 'sky', order: 4, memberEdit: true, description: 'Power, tether, control station and code.', driveFolder: null, tree: [] },
    business: { name: 'Business', icon: '💼', color: 'navy', order: 5, memberEdit: true, description: 'Sponsors, budget, fundraising and outreach.', driveFolder: null, tree: [] },
    media: { name: 'Media', icon: '🎬', color: 'orange', order: 6, memberEdit: true, description: 'Photos, video, social and the marketing display.', driveFolder: null, tree: [] },
  },
};

function StarterContent({ settingsSaved }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await api.seedStarter({ ...STARTER, ...(settingsSaved ? {} : { config: { settings: DEFAULT_SETTINGS } }) });
      api.log(profile, 'setup.starter', 'Added starter subteams, activities and spaces');
      toast('Starter subteams, activities and spaces added.');
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<div style="margin-bottom:20px"><${Notice} kind="info">
    <b>Set up the basics in one click.</b> Adds four subteams (Mechanical, Electrical & Software, Media, Business), the activities members pick when they clock in, and spaces for Club HQ, Crush Depth and each subteam. You can rename or remove any of it afterwards.
    <div style="margin-top:10px"><button class="btn btn-primary btn-sm" onClick=${add} disabled=${busy}>${busy ? 'Adding…' : 'Add starter content'}</button></div>
  </${Notice}></div>`;
}

// ───────── Members ─────────
function MembersAdmin() {
  const { api, profile, pendingMembers, subteams } = useStore((s) => ({ api: s.api, profile: s.profile, pendingMembers: s.pendingMembers, subteams: s.subteams }));
  const rev = useStore((s) => s.rev);
  const res = useAsync(() => api.listMembers({ includeAll: true }), [api, rev, pendingMembers.length]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const decline = async (m) => {
    if (!(await confirmDialog({ title: `Decline ${m.name}?`, body: 'They won’t get access. You can approve them later from the “Not approved” filter.', confirmLabel: 'Decline', danger: true }))) return;
    try { await api.adminUpdateUser(m.uid, { status: 'denied' }); api.log(profile, 'member.deny', `Declined ${m.name} (${m.email})`, { type: 'user', id: m.uid }); bump(); toast('Declined.'); } catch (e) { toastError(e); }
  };
  const list = (res.data || []).filter((m) => (status === 'all' || m.status === status) && (!q || `${m.name} ${m.email} ${m.title}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name));
  return html`
    ${pendingMembers.length > 0 && html`<section class="panel" style="margin-bottom:20px">
      <div class="panel-head"><h2>Asking to join</h2><span class="badge badge-warn">${pendingMembers.length}</span></div>
      <ul class="list list-flush">${pendingMembers.map((m) => html`<li key=${m.uid}>
        <${Avatar} person=${m} size=${38} />
        <span class="grow"><b>${m.name}</b> <span class="small muted">${m.email}</span>
          <div class="meta">${[m.pronouns, m.major].filter(Boolean).join(', ')}${m.createdAt ? `${m.pronouns || m.major ? '. ' : ''}Asked ${relTime(m.createdAt)}` : ''}</div>
          ${m.subteams?.length > 0 && html`<div class="chips" style="margin-top:6px">${m.subteams.map((id) => html`<${Chip} key=${id} color=${subteamById(id) ? seriesColor(subteamById(id).color) : null}>${subteamById(id)?.name || id}</${Chip}>`)}</div>`}
          ${m.joinNote && html`<p class="small" style="margin:6px 0 0;color:var(--text-2)">“${m.joinNote}”</p>`}</span>
        <div class="row wrap" style="gap:6px;justify-content:flex-end">
          <button class="btn btn-sm btn-primary" onClick=${() => openMemberManager(m, { approving: true })}><${Icon} name="check" />Approve</button>
          <button class="btn btn-sm btn-quiet" onClick=${() => decline(m)}>Decline</button></div>
      </li>`)}</ul>
    </section>`}
    <div class="row wrap" style="gap:10px;margin-bottom:12px">
      <div class="search" style="flex:1;min-width:220px"><${Icon} name="search" /><input class="input" type="search" placeholder="Search name or email" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <select class="select" style="width:auto" value=${status} onChange=${(e) => setStatus(e.target.value)} aria-label="Status">
        <option value="active">Active</option><option value="inactive">Inactive (alumni)</option><option value="denied">Not approved</option><option value="pending">Waiting</option><option value="all">Everyone</option></select>
    </div>
    ${res.loading && !res.data ? html`<${Loading} />` : html`<div class="table-wrap"><table class="table">
      <thead><tr><th>Member</th><th>Role</th><th>Title</th><th>Subteams</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.map((m) => html`<tr key=${m.uid}>
        <td><div class="row" style="gap:10px"><${Avatar} person=${m} size=${28} /><div><a href=${href('/members/' + m.uid)} style="color:var(--text);font-weight:600">${m.name}</a><div class="tiny muted">${m.email}</div></div></div></td>
        <td>${ROLE[m.role]}</td><td>${m.title || html`<span class="muted">None</span>`}</td>
        <td><div class="chips">${(m.subteams || []).map((id) => subteamById(id) && html`<${Chip} key=${id} color=${seriesColor(subteamById(id).color)}>${subteamById(id).name}</${Chip}>`)}</div></td>
        <td>${STATUS[m.status] || m.status}</td>
        <td><button class="btn btn-sm" onClick=${() => openMemberManager(m)}>Manage</button></td>
      </tr>`)}</tbody></table></div>
      ${!list.length && html`<p class="muted">Nobody matches.</p>`}`}
  `;
}

export function openMemberManager(m, opts = {}) { openModal((close) => html`<${MemberManager} m=${m} close=${close} ...${opts} />`); }
function MemberManager({ m, close, approving }) {
  const { api, profile, subteams } = useStore((s) => ({ api: s.api, profile: s.profile, subteams: s.subteams }));
  const [f, setF] = useState({ role: m.role || 'member', status: approving ? 'active' : m.status, title: m.title || '', subteams: (m.subteams || []).filter((id) => subteamById(id)) });
  const [busy, setBusy] = useState(false);
  const self = m.uid === profile.uid;
  const save = async () => {
    if (self && (f.role !== 'admin' || f.status !== 'active') && !(await confirmDialog({ title: 'Remove your own admin access?', body: 'You won’t be able to undo this yourself. Another admin would have to restore it.', confirmLabel: 'Yes, change it', danger: true }))) return;
    setBusy(true);
    try {
      await api.adminUpdateUser(m.uid, { role: f.role, status: f.status, title: f.title.trim().slice(0, 80), subteams: f.subteams });
      const what = approving ? `Approved ${m.name} as ${ROLE[f.role].toLowerCase()}` : `Updated ${m.name}: ${ROLE[f.role]}, ${STATUS[f.status] || f.status}${f.title ? `, ${f.title}` : ''}`;
      api.log(profile, approving ? 'member.approve' : 'member.update', what, { type: 'user', id: m.uid });
      setState({ membersCache: null }); bump();
      toast(approving ? `${m.name.split(' ')[0]} is in.` : 'Member saved.');
      close();
    } catch (e) { toastError(e); setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: `Delete ${m.name}’s account?`, body: 'Their profile is removed and they lose access. Their past hours stay in reports. To keep their profile, mark them inactive instead.', confirmLabel: 'Delete account', danger: true }))) return;
    try { await api.adminDeleteUser(m.uid); api.log(profile, 'member.delete', `Deleted ${m.name}’s account (${m.email})`, { type: 'user', id: m.uid }); setState({ membersCache: null }); bump(); toast('Account deleted.'); close(); } catch (e) { toastError(e); }
  };
  return html`<${Modal} title=${approving ? `Approve ${m.name}` : `Manage ${m.name}`} onClose=${close} wide
    footer=${html`${!approving && !self && html`<button class="btn btn-danger left" onClick=${remove}><${Icon} name="trash" />Delete account</button>`}
      <button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>${approving ? 'Approve' : 'Save'}</button>`}>
    <div class="row" style="gap:12px;margin-bottom:16px"><${Avatar} person=${m} size=${44} /><div><b>${m.name}</b><div class="small muted">${m.email}</div></div></div>
    <div class="form-grid">
      <${Field} label="Role" hint=${f.role === 'admin' ? 'Admins can change anything, including other admins.' : f.role === 'lead' ? 'Leads approve hours, run reports, post announcements and events, and edit every space.' : 'Members clock in, edit pages in open spaces and work on tasks.'}>
        <select class="select" value=${f.role} onChange=${(e) => setF({ ...f, role: e.target.value })}><option value="member">Member</option><option value="lead">Lead (officer)</option><option value="admin">Admin</option></select></${Field}>
      <${Field} label="Status"><select class="select" value=${f.status} onChange=${(e) => setF({ ...f, status: e.target.value })}>
        ${Object.entries(STATUS).map(([k, l]) => html`<option value=${k} key=${k}>${l}</option>`)}</select></${Field}>
      <${Field} label="Title (optional)" full><input class="input" value=${f.title} maxlength="80" placeholder="Director of Software" onInput=${(e) => setF({ ...f, title: e.target.value })} /></${Field}>
      <div class="field full"><span>Subteams</span><div class="chips">${subteams.map((s) => html`<button type="button" key=${s.id} class="chip chip-toggle" aria-pressed=${String(f.subteams.includes(s.id))}
        onClick=${() => setF({ ...f, subteams: f.subteams.includes(s.id) ? f.subteams.filter((x) => x !== s.id) : [...f.subteams, s.id] })}>${s.name}</button>`)}</div></div>
    </div>
    ${m.joinNote && html`<p class="small" style="margin:14px 0 0;color:var(--text-2)">Their note: “${m.joinNote}”</p>`}
  </${Modal}>`;
}

// ───────── Invites ─────────
function InvitesAdmin() {
  const { api, profile, subteams } = useStore((s) => ({ api: s.api, profile: s.profile, subteams: s.subteams }));
  const [tick, setTick] = useState(0);
  const res = useAsync(() => api.listInvites(), [api, tick]);
  const [f, setF] = useState({ email: '', role: 'member', title: '', subteams: [] });
  const [err, setErr] = useState('');
  const add = async (e) => {
    e.preventDefault();
    const emails = f.email.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!emails.length || !emails.every((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) return setErr('Enter one or more email addresses, separated by commas.');
    try {
      for (const email of emails) await api.saveInvite({ email, role: f.role, title: f.title.trim(), subteams: f.subteams }, profile);
      api.log(profile, 'invite.add', `Invited ${emails.join(', ')} as ${ROLE[f.role].toLowerCase()}`);
      setF({ ...f, email: '', title: '' }); setErr(''); setTick(tick + 1);
      toast(emails.length > 1 ? `${emails.length} people invited.` : 'Invited.');
    } catch (ex) { toastError(ex); }
  };
  const remove = async (inv) => { try { await api.deleteInvite(inv.email); setTick(tick + 1); toast('Invite removed.'); } catch (e) { toastError(e); } };
  return html`
    <p class="muted" style="margin-top:0;max-width:70ch">People on this list skip the approval step: the first time they sign in with that Google account, they get the role you set here. Use it for officers, returning members, or a whole roster at once. It doesn’t send an email; share the portal link with them.</p>
    <form class="panel panel-pad form-grid" onSubmit=${add} style="margin-bottom:20px">
      <${Field} label="Email addresses" full hint="Separate several with commas."><input class="input" value=${f.email} onInput=${(e) => setF({ ...f, email: e.target.value })} placeholder="name@gmail.com, other@my.school.edu" /></${Field}>
      <${Field} label="Role"><select class="select" value=${f.role} onChange=${(e) => setF({ ...f, role: e.target.value })}><option value="member">Member</option><option value="lead">Lead (officer)</option><option value="admin">Admin</option></select></${Field}>
      <${Field} label="Title (optional)"><input class="input" value=${f.title} maxlength="80" onInput=${(e) => setF({ ...f, title: e.target.value })} /></${Field}>
      <div class="field full"><span>Subteams</span><div class="chips">${subteams.map((s) => html`<button type="button" key=${s.id} class="chip chip-toggle" aria-pressed=${String(f.subteams.includes(s.id))}
        onClick=${() => setF({ ...f, subteams: f.subteams.includes(s.id) ? f.subteams.filter((x) => x !== s.id) : [...f.subteams, s.id] })}>${s.name}</button>`)}</div></div>
      ${err && html`<p class="form-error full">${err}</p>`}
      <div class="full"><button class="btn btn-primary" type="submit"><${Icon} name="plus" />Add to invite list</button></div>
    </form>
    ${res.loading && !res.data ? html`<${Loading} />` : !(res.data || []).length ? html`<p class="muted">No invites yet.</p>` : html`<div class="panel"><ul class="list list-flush">${res.data.map((inv) => html`<li key=${inv.email}>
      <${Icon} name="mail" size=${20} /><span class="grow"><b>${inv.email}</b><div class="meta">${ROLE[inv.role]}${inv.title ? `, ${inv.title}` : ''}${inv.invitedByName ? `. Added by ${inv.invitedByName}` : ''}</div></span>
      <button class="btn btn-sm btn-quiet" onClick=${() => remove(inv)}>Remove</button></li>`)}</ul></div>`}
  `;
}

// ───────── Subteams ─────────
function SubteamsAdmin() {
  const { api, profile, subteams } = useStore((s) => ({ api: s.api, profile: s.profile, subteams: s.subteams }));
  const [name, setName] = useState('');
  const save = async (item, label) => { try { await api.saveRef('subteams', item); if (label) toast(label); } catch (e) { toastError(e); } };
  const add = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const used = new Set(subteams.map((s) => s.color));
    await save({ name: name.trim(), color: PALETTE_KEYS.find((k) => !used.has(k)) || 'navy', order: subteams.length + 1 }, 'Subteam added.');
    api.log(profile, 'subteam.add', `Added subteam “${name.trim()}”`);
    setName('');
  };
  return html`
    <p class="muted" style="margin-top:0;max-width:70ch">Subteams group members and color their hours in reports. Colors come from a set that stays readable for colorblind members.</p>
    <div class="panel"><ul class="list list-flush">${subteams.map((s) => html`<li key=${s.id} style="align-items:center">
      <i style=${{ width: '14px', height: '14px', borderRadius: '4px', background: seriesColor(s.color), flex: 'none' }}></i>
      <input class="input" style="max-width:320px" value=${s.name} maxlength="60" aria-label="Subteam name" onChange=${(e) => e.target.value.trim() && save({ id: s.id, name: e.target.value.trim() }, 'Renamed.')} />
      <select class="select" style="width:auto" value=${PALETTE_KEYS.includes(s.color) ? s.color : ''} aria-label="Color" onChange=${(e) => save({ id: s.id, color: e.target.value })}>
        ${!PALETTE_KEYS.includes(s.color) && html`<option value="">Custom</option>`}${PALETTE_KEYS.map((k) => html`<option value=${k} key=${k}>${k[0].toUpperCase() + k.slice(1)}</option>`)}</select>
      <span class="spacer"></span>
      <button class="btn btn-sm btn-quiet" onClick=${async () => { if (await confirmDialog({ title: `Archive ${s.name}?`, body: 'It disappears from pickers. Past hours keep their subteam in reports.', confirmLabel: 'Archive' })) { save({ id: s.id, archived: true }, 'Archived.'); api.log(profile, 'subteam.archive', `Archived subteam “${s.name}”`); } }}>Archive</button>
    </li>`)}</ul></div>
    <form class="row" style="margin-top:14px" onSubmit=${add}><input class="input" style="max-width:320px" placeholder="New subteam name" value=${name} maxlength="60" onInput=${(e) => setName(e.target.value)} />
      <button class="btn" type="submit"><${Icon} name="plus" />Add subteam</button></form>`;
}

// ───────── Activities ─────────
function ActivitiesAdmin() {
  const { api, profile, activities, subteams } = useStore((s) => ({ api: s.api, profile: s.profile, activities: s.activities, subteams: s.subteams }));
  const [f, setF] = useState({ name: '', subteamId: '' });
  const save = async (item, label) => { try { await api.saveRef('activities', item); if (label) toast(label); } catch (e) { toastError(e); } };
  const add = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    await save({ name: f.name.trim(), subteamId: f.subteamId || null, order: activities.length + 1, archived: false }, 'Activity added.');
    api.log(profile, 'activity.add', `Added activity “${f.name.trim()}”`);
    setF({ name: '', subteamId: '' });
  };
  return html`
    <p class="muted" style="margin-top:0;max-width:70ch">Members pick one of these when they clock in. Tie an activity to a subteam so those members see it first. Reports can group hours by activity.</p>
    <div class="panel"><ul class="list list-flush">${activities.map((a) => html`<li key=${a.id} style="align-items:center;opacity:${a.archived ? 0.55 : 1}">
      <input class="input" style="max-width:320px" value=${a.name} maxlength="60" aria-label="Activity name" onChange=${(e) => e.target.value.trim() && save({ id: a.id, name: e.target.value.trim() }, 'Renamed.')} />
      <select class="select" style="width:auto" value=${a.subteamId || ''} aria-label="Subteam" onChange=${(e) => save({ id: a.id, subteamId: e.target.value || null })}>
        <option value="">Everyone</option>${subteams.map((s) => html`<option value=${s.id} key=${s.id}>${s.name}</option>`)}</select>
      <span class="spacer"></span>
      <button class="btn btn-sm btn-quiet" onClick=${() => save({ id: a.id, archived: !a.archived }, a.archived ? 'Restored.' : 'Archived.')}>${a.archived ? 'Restore' : 'Archive'}</button>
    </li>`)}</ul></div>
    <form class="row wrap" style="margin-top:14px" onSubmit=${add}>
      <input class="input" style="max-width:320px" placeholder="New activity, e.g. Pool test" value=${f.name} maxlength="60" onInput=${(e) => setF({ ...f, name: e.target.value })} />
      <select class="select" style="width:auto" value=${f.subteamId} onChange=${(e) => setF({ ...f, subteamId: e.target.value })} aria-label="Subteam"><option value="">Everyone</option>${subteams.map((s) => html`<option value=${s.id} key=${s.id}>${s.name}</option>`)}</select>
      <button class="btn" type="submit"><${Icon} name="plus" />Add activity</button></form>`;
}

// ───────── Spaces ─────────
function SpacesAdmin() {
  const { api, profile, spaces } = useStore((s) => ({ api: s.api, profile: s.profile, spaces: s.spaces }));
  const remove = async (sp) => {
    if (!(await confirmDialog({ title: `Delete ${sp.name}?`, body: `Its ${(sp.tree || []).length} pages and its task board are deleted for everyone. Files in Google Drive aren’t touched. This can’t be undone.`, confirmLabel: 'Delete space', danger: true }))) return;
    try { await api.deleteSpace(sp.id); api.log(profile, 'space.delete', `Deleted space “${sp.name}” with ${(sp.tree || []).length} pages`, { type: 'space', id: sp.id }); toast('Space deleted.'); } catch (e) { toastError(e); }
  };
  const rebuild = async (sp) => { try { const n = await api.rebuildTree(sp.id); toast(`Page list rebuilt: ${n} pages.`); } catch (e) { toastError(e); } };
  return html`
    <div class="row" style="margin-bottom:14px"><p class="muted" style="margin:0;flex:1;max-width:70ch">Spaces hold pages, a task board and a linked Google Drive folder. Turn off member editing for spaces only leads should change.</p>
      <button class="btn btn-primary" onClick=${() => openModal((close) => html`<${SpaceSettings} space=${null} close=${close} />`)}><${Icon} name="plus" />New space</button></div>
    <div class="panel"><ul class="list list-flush">${spaces.map((sp) => html`<li key=${sp.id} style="align-items:center">
      <span style="font-size:24px;width:32px;text-align:center">${sp.icon}</span>
      <span class="grow"><a class="title" href=${href('/s/' + sp.id)}>${sp.name}</a>
        <div class="meta">${(sp.tree || []).length} pages. ${sp.memberEdit ? 'Every member can edit.' : 'Leads only.'}${sp.driveFolder ? ' Drive folder linked.' : ''}</div></span>
      <button class="btn btn-sm" onClick=${() => openSpaceSettings(sp)}>Settings</button>
      <${Menu} items=${[{ label: 'Rebuild page list', icon: 'refresh', onClick: () => rebuild(sp) }, { label: 'Delete space', icon: 'trash', danger: true, onClick: () => remove(sp) }]} />
    </li>`)}</ul></div>`;
}

// ───────── Settings ─────────
function SettingsAdmin() {
  const { api, profile, settings } = useStore((s) => ({ api: s.api, profile: s.profile, settings: s.settings }));
  const [f, setF] = useState(() => JSON.parse(JSON.stringify(settings)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const lc = f.locationCheck || {};
  const setLc = (patch) => setF({ ...f, locationCheck: { ...lc, ...patch } });
  const here = () => navigator.geolocation?.getCurrentPosition(
    (p) => { setLc({ lat: Math.round(p.coords.latitude * 1e6) / 1e6, lng: Math.round(p.coords.longitude * 1e6) / 1e6 }); toast(`Lab location set (accurate to about ${Math.round(p.coords.accuracy)} m).`); },
    () => toast('Couldn’t get your location. Allow location for this site and try again.', { kind: 'bad' }), { enableHighAccuracy: true, timeout: 10000 });
  const save = async (e) => {
    e.preventDefault();
    const max = Math.round(Number(f.maxSessionHours));
    if (!(max >= 2 && max <= 16)) return setErr('Longest session should be between 2 and 16 hours.');
    if (f.termStart && f.termEnd && f.termEnd <= f.termStart) return setErr('The term has to end after it starts.');
    if (lc.enabled && (lc.lat == null || lc.lng == null)) return setErr('Set the lab location before turning on the location check.');
    setBusy(true); setErr('');
    try {
      await api.saveSettings({
        clubName: f.clubName.trim(), meetingInfo: f.meetingInfo.trim(), termName: f.termName.trim(), termStart: f.termStart, termEnd: f.termEnd,
        termGoalHours: Number(f.termGoalHours) || 0, weeklyGoalHours: Number(f.weeklyGoalHours) || 0, maxSessionHours: max,
        locationCheck: { enabled: !!lc.enabled, mode: lc.mode === 'block' ? 'block' : 'flag', lat: lc.lat == null ? null : Number(lc.lat), lng: lc.lng == null ? null : Number(lc.lng), radiusM: Math.max(50, Number(lc.radiusM) || 250) },
        updatedBy: profile.uid,
      });
      api.log(profile, 'settings.save', 'Updated club settings');
      toast('Settings saved.');
    } catch (ex) { toastError(ex); }
    setBusy(false);
  };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return html`<form onSubmit=${save} class="stack" style="max-width:820px">
    <section class="panel panel-pad"><h2 style="margin:0 0 14px;font-size:16px">Club</h2><div class="form-grid">
      <${Field} label="Club name"><input class="input" value=${f.clubName} onInput=${set('clubName')} /></${Field}>
      <${Field} label="Regular meeting"><input class="input" value=${f.meetingInfo} onInput=${set('meetingInfo')} placeholder="Day, time and room" /></${Field}>
    </div></section>
    <section class="panel panel-pad"><h2 style="margin:0 0 4px;font-size:16px">Term and hour goals</h2>
      <p class="small muted" style="margin:0 0 14px">“This term” in reports and on Home uses these dates. Goals show as progress bars for members.</p><div class="form-grid">
      <${Field} label="Term name"><input class="input" value=${f.termName} onInput=${set('termName')} placeholder="Spring 2027" /></${Field}>
      <div></div>
      <${Field} label="Term starts"><input class="input" type="date" value=${f.termStart} onInput=${set('termStart')} /></${Field}>
      <${Field} label="Term ends"><input class="input" type="date" value=${f.termEnd} onInput=${set('termEnd')} /></${Field}>
      <${Field} label="Term goal (hours)" hint="0 hides the progress bar."><input class="input" type="number" min="0" max="1000" value=${f.termGoalHours} onInput=${set('termGoalHours')} /></${Field}>
      <${Field} label="Weekly goal (hours)"><input class="input" type="number" min="0" max="80" value=${f.weeklyGoalHours} onInput=${set('weeklyGoalHours')} /></${Field}>
    </div></section>
    <section class="panel panel-pad"><h2 style="margin:0 0 4px;font-size:16px">Clocking in and out</h2>
      <p class="small muted" style="margin:0 0 14px">A session longer than this needs a lead’s approval. That catches forgotten clock-outs.</p><div class="form-grid">
      <${Field} label="Longest session without approval (hours)"><input class="input" type="number" min="2" max="16" value=${f.maxSessionHours} onInput=${set('maxSessionHours')} /></${Field}>
    </div>
      <label class="check" style="margin-top:16px"><input type="checkbox" checked=${!!lc.enabled} onChange=${(e) => setLc({ enabled: e.target.checked })} />
        <span><b>Check that members are at the lab when they clock in</b><br /><span class="small muted">Uses the phone’s location once at clock-in. Only “at the lab” or “away” is saved, never the location itself. Someone determined can fake it, so treat it as a nudge.</span></span></label>
      ${lc.enabled && html`<div class="form-grid" style="margin-top:14px">
        <${Field} label="When someone is away from the lab"><select class="select" value=${lc.mode} onChange=${(e) => setLc({ mode: e.target.value })}><option value="flag">Let them clock in, flag it for leads</option><option value="block">Don’t let them clock in</option></select></${Field}>
        <${Field} label="Distance that counts as at the lab (meters)"><input class="input" type="number" min="50" max="2000" value=${lc.radiusM} onInput=${(e) => setLc({ radiusM: e.target.value })} /></${Field}>
        <div class="field full"><span>Lab location</span><div class="row wrap">
          <input class="input" style="max-width:170px" type="number" step="any" placeholder="Latitude" value=${lc.lat ?? ''} onInput=${(e) => setLc({ lat: e.target.value === '' ? null : e.target.value })} aria-label="Latitude" />
          <input class="input" style="max-width:170px" type="number" step="any" placeholder="Longitude" value=${lc.lng ?? ''} onInput=${(e) => setLc({ lng: e.target.value === '' ? null : e.target.value })} aria-label="Longitude" />
          <button class="btn btn-sm" type="button" onClick=${here}><${Icon} name="mapPin" />Use my current location</button></div>
          <small>Easiest: stand in the lab and tap “Use my current location”.</small></div>
      </div>`}
    </section>
    ${err && html`<p class="form-error" role="alert">${err}</p>`}
    <div><button class="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Saving…' : 'Save settings'}</button></div>
  </form>`;
}

// ───────── Audit log ─────────
function AuditAdmin() {
  const api = useStore((s) => s.api);
  const res = useAsync(() => api.listAudit(), [api]);
  return html`
    <p class="muted" style="margin-top:0;max-width:70ch">What leads and admins changed: approvals, edits to hours, roles, settings and deletions. Entries can’t be edited or deleted from the portal.</p>
    ${res.loading && !res.data ? html`<${Loading} />` : !(res.data || []).length ? html`<p class="muted">Nothing logged yet.</p>`
    : html`<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
      <tbody>${res.data.map((a) => html`<tr key=${a.id}><td class="nowrap" title=${fmtDateTime(a.at)}>${relTime(a.at)}</td><td class="nowrap">${a.actorName}</td><td>${a.summary}</td></tr>`)}</tbody></table></div>`}`;
}
