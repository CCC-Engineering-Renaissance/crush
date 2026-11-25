// Admin: approve members, roles, invites, subsidiaries and subteams, activities, spaces and who can
// open them, settings and the audit log.
import { html, useState, useEffect, useMemo, Icon, Avatar, Modal, openModal, Field, Chip, Menu, Loading, Empty, Notice, useAsync, toast, toastError, confirmDialog } from '../lib/ui.js';
import { useStore, setState, getState, isAdmin, subteamById, subteamLabel, groupBySubsidiary, bump, DEFAULT_SETTINGS } from '../lib/store.js';
import { href, go } from '../lib/router.js';
import { relTime, fmtDateTime } from '../lib/time.js';
import { seriesColor, PALETTE_KEYS } from './charts.js';
import { openSpaceSettings, openNewSpace, openSpaceAccess } from './spaces.js';
import { useTitle, SubteamPicker, SpaceIcon } from './common.js';

const TABS = [['members', 'Members'], ['invites', 'Invites'], ['subteams', 'Subsidiaries and subteams'], ['activities', 'Activities'], ['spaces', 'Spaces'], ['settings', 'Settings'], ['audit', 'Audit log']];
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
// Crush Depth's subteams and spaces follow the team's Discord channels. Prosthetic's three are a
// starting guess (electrical, mechanical, signal processing); rename them to match.
const sub = (name, subsidiaryId, color, order) => ({ name, subsidiaryId, color, order, discordRole: '' });
const space = (name, subsidiaryId, subteamId, order, description, extra = {}) => ({ name, subsidiaryId, subteamId, order, description, memberEdit: true, private: false, ...extra });
const STARTER_SPACES = {
  'club-hq': space('club-hq', null, null, 1, 'How the club runs: onboarding, lab safety and meeting notes.', { memberEdit: false }),
  'cd-mgmt': space('mate-club-mgmt', 'crush', null, 1, 'Running the MATE team: budget, sponsors, travel and registration.', { private: true }),
  'cd-leads': space('tech-leads', 'crush', null, 2, 'Subteam leads: design reviews, priorities and the season plan.', { private: true }),
  'cd-marketing': space('mate-marketing', 'crush', 'cd-marketing', 3, 'Social posts, the marketing display and sponsor thank-yous.'),
  'cd-float': space('float', 'crush', 'cd-float', 4, 'Buoyancy, foam and trim.'),
  'cd-housing': space('housing', 'crush', 'cd-housing', 5, 'The electronics enclosure, seals and pressure tests.'),
  'cd-manips': space('manips', 'crush', 'cd-manips', 6, 'Manipulators and grippers.'),
  'cd-chassis': space('chassis', 'crush', 'cd-chassis', 7, 'The frame, mounts and machining.'),
  'cd-electrical': space('electrical', 'crush', 'cd-electrical', 8, 'Power, the tether and wiring.'),
  'cd-controls': space('controls-systems', 'crush', 'cd-controls', 9, 'Control code, the control station and sensors.'),
  'pr-electrical': space('electrical', 'prosthetic', 'pr-electrical', 1, 'The EEG headset, amplifier board and motor drivers.'),
  'pr-mechanical': space('mechanical', 'prosthetic', 'pr-mechanical', 2, 'Finger linkages, the palm and the socket.'),
  'pr-signal': space('signal-processing', 'prosthetic', 'pr-signal', 3, 'Filtering EEG signals and turning them into grip commands.'),
};
export const STARTER = {
  subsidiaries: {
    crush: { name: 'Crush Depth', color: 'sky', order: 1, discordRole: '' },
    prosthetic: { name: 'Prosthetic', color: 'lime', order: 2, discordRole: '' },
  },
  subteams: {
    'cd-marketing': sub('Marketing', 'crush', 'orange', 1),
    'cd-float': sub('Float', 'crush', 'sky', 2),
    'cd-housing': sub('Housing', 'crush', 'navy', 3),
    'cd-manips': sub('Manips', 'crush', 'magenta', 4),
    'cd-chassis': sub('Chassis', 'crush', 'lime', 5),
    'cd-electrical': sub('Electrical', 'crush', 'gold', 6),
    'cd-controls': sub('Controls systems', 'crush', 'sky', 7),
    'pr-electrical': sub('Electrical', 'prosthetic', 'gold', 1),
    'pr-mechanical': sub('Mechanical', 'prosthetic', 'lime', 2),
    'pr-signal': sub('Signal processing', 'prosthetic', 'magenta', 3),
  },
  activities: {
    meeting: { name: 'General meeting', subteamId: null, order: 1 },
    build: { name: 'Build & fabrication', subteamId: 'cd-chassis', order: 2 },
    cad: { name: 'CAD & design', subteamId: null, order: 3 },
    wiring: { name: 'Electronics & wiring', subteamId: 'cd-electrical', order: 4 },
    code: { name: 'Software & controls', subteamId: 'cd-controls', order: 5 },
    pool: { name: 'Pool test', subteamId: null, order: 6 },
    docs: { name: 'Technical documentation', subteamId: null, order: 7 },
    media: { name: 'Photo, video & social', subteamId: 'cd-marketing', order: 8 },
    sponsors: { name: 'Fundraising & sponsors', subteamId: null, order: 9 },
    eeg: { name: 'EEG & signal processing', subteamId: 'pr-signal', order: 10 },
    hand: { name: 'Prosthetic hand build', subteamId: 'pr-mechanical', order: 11 },
    outreach: { name: 'Outreach event', subteamId: null, order: 12 },
    intro: { name: 'Intro projects', subteamId: null, order: 13 },
  },
  spaces: STARTER_SPACES,
  spaceContent: Object.fromEntries(Object.keys(STARTER_SPACES).map((id) => [id, { tree: [], driveFolder: null }])),
};

function StarterContent({ settingsSaved }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await api.seedStarter({ ...STARTER, ...(settingsSaved ? {} : { config: { settings: DEFAULT_SETTINGS } }) });
      api.log(profile, 'setup.starter', 'Added the starter subsidiaries, subteams, activities and spaces');
      toast('Starter subsidiaries, subteams, activities and spaces added.');
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<div style="margin-bottom:20px"><${Notice} kind="info">
    <b>Set up the basics in one click.</b> Adds Crush Depth and Prosthetic as subsidiaries, with a subteam and a space for each of Crush Depth’s Discord channels (mate-club-mgmt and tech-leads start out private). Also adds a club-wide club-hq space and the activities members pick when they clock in. Prosthetic’s three subteams are a guess from the website, so rename them to match. You can change any of it afterwards.
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
          ${m.subteams?.length > 0 && html`<div class="chips" style="margin-top:6px">${m.subteams.map((id) => html`<${Chip} key=${id} color=${subteamById(id) ? seriesColor(subteamById(id).color) : null}>${subteamLabel(id) || id}</${Chip}>`)}</div>`}
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
        <td><div class="chips">${(m.subteams || []).map((id) => subteamById(id) && html`<${Chip} key=${id} color=${seriesColor(subteamById(id).color)}>${subteamLabel(id)}</${Chip}>`)}</div></td>
        <td>${STATUS[m.status] || m.status}</td>
        <td><button class="btn btn-sm" onClick=${() => openMemberManager(m)}>Manage</button></td>
      </tr>`)}</tbody></table></div>
      ${!list.length && html`<p class="muted">Nobody matches.</p>`}`}
  `;
}

export function openMemberManager(m, opts = {}) { openModal((close) => html`<${MemberManager} m=${m} close=${close} ...${opts} />`); }
function MemberManager({ m, close, approving }) {
  const { api, profile, spaces, subsidiaries } = useStore((s) => ({ api: s.api, profile: s.profile, spaces: s.spaces, subsidiaries: s.subsidiaries }));
  const [f, setF] = useState({ role: m.role || 'member', status: approving ? 'active' : m.status, title: m.title || '', subteams: (m.subteams || []).filter((id) => subteamById(id)) });
  // Private spaces they can open. When approving, suggest the ones tied to the subteams they picked.
  const privateSpaces = spaces.filter((sp) => sp.private);
  const [open, setOpen] = useState(() => {
    const set = new Set((m.spaces || []).filter((id) => spaces.some((sp) => sp.id === id)));
    if (approving) privateSpaces.forEach((sp) => { if (sp.subteamId && (m.subteams || []).includes(sp.subteamId)) set.add(sp.id); });
    return set;
  });
  const flip = (id) => { const next = new Set(open); next.has(id) ? next.delete(id) : next.add(id); setOpen(next); };
  const [busy, setBusy] = useState(false);
  const self = m.uid === profile.uid;
  const save = async () => {
    if (self && (f.role !== 'admin' || f.status !== 'active') && !(await confirmDialog({ title: 'Remove your own admin access?', body: 'You won’t be able to undo this yourself. Another admin would have to restore it.', confirmLabel: 'Yes, change it', danger: true }))) return;
    setBusy(true);
    try {
      const spacesNow = [...open];
      await api.adminUpdateUser(m.uid, { role: f.role, status: f.status, title: f.title.trim().slice(0, 80), subteams: f.subteams, spaces: spacesNow });
      const before = new Set(m.spaces || []);
      const added = spacesNow.filter((id) => !before.has(id)).length, removed = [...before].filter((id) => !open.has(id)).length;
      const spaceNote = added || removed ? `; private spaces: ${added} added, ${removed} removed` : '';
      const what = approving ? `Approved ${m.name} as ${ROLE[f.role].toLowerCase()}${spaceNote}` : `Updated ${m.name}: ${ROLE[f.role]}, ${STATUS[f.status] || f.status}${f.title ? `, ${f.title}` : ''}${spaceNote}`;
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
  const groups = groupBySubsidiary(privateSpaces, subsidiaries).filter((g) => g.items.length);
  return html`<${Modal} title=${approving ? `Approve ${m.name}` : `Manage ${m.name}`} onClose=${close} wide
    footer=${html`${!approving && !self && html`<button class="btn btn-danger left" onClick=${remove}><${Icon} name="trash" />Delete account</button>`}
      <button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>${approving ? 'Approve' : 'Save'}</button>`}>
    <div class="row" style="gap:12px;margin-bottom:16px"><${Avatar} person=${m} size=${44} /><div><b>${m.name}</b><div class="small muted">${m.email}</div></div></div>
    <div class="form-grid">
      <${Field} label="Role" hint=${f.role === 'admin' ? 'Admins can change anything, including other admins, and open every space.' : f.role === 'lead' ? 'Leads approve hours, run reports, post announcements and events, and edit the spaces they can open.' : 'Members clock in, edit pages in the spaces they can open and work on tasks.'}>
        <select class="select" value=${f.role} onChange=${(e) => setF({ ...f, role: e.target.value })}><option value="member">Member</option><option value="lead">Lead (officer)</option><option value="admin">Admin</option></select></${Field}>
      <${Field} label="Status"><select class="select" value=${f.status} onChange=${(e) => setF({ ...f, status: e.target.value })}>
        ${Object.entries(STATUS).map(([k, l]) => html`<option value=${k} key=${k}>${l}</option>`)}</select></${Field}>
      <${Field} label="Title (optional)" full><input class="input" value=${f.title} maxlength="80" placeholder="Director of Software" onInput=${(e) => setF({ ...f, title: e.target.value })} /></${Field}>
      <div class="field full"><span>Subteams</span><${SubteamPicker} value=${f.subteams} onChange=${(v) => setF({ ...f, subteams: v })} /></div>
      <div class="field full"><span>Private spaces they can open</span>
        ${f.role === 'admin' ? html`<p class="small muted" style="margin:0">Admins can open every space.</p>`
        : !groups.length ? html`<p class="small muted" style="margin:0">There are no private spaces. Everyone can open every space.</p>`
        : html`<div class="pick-groups">${groups.map((g) => html`<div class="pick-group" key=${g.sub?.id || '-'} role="group" aria-label=${`${g.sub?.name || 'Club-wide'} private spaces`}>
            <span class="pick-group-name" aria-hidden="true">${g.sub?.name || 'Club-wide'}</span>
            <div class="chips">${g.items.map((sp) => html`<button type="button" key=${sp.id} class="chip chip-toggle" aria-pressed=${String(open.has(sp.id))} onClick=${() => flip(sp.id)}><${SpaceIcon} space=${sp} size=${14} />${sp.name}</button>`)}</div>
          </div>`)}</div>
          <small>Spaces open to every member aren’t listed.${approving ? ' Spaces tied to the subteams they picked are already selected.' : ''}</small>`}
      </div>
    </div>
    ${m.joinNote && html`<p class="small" style="margin:14px 0 0;color:var(--text-2)">Their note: “${m.joinNote}”</p>`}
  </${Modal}>`;
}

// ───────── Invites ─────────
function InvitesAdmin() {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
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
      <div class="field full"><span>Subteams</span><${SubteamPicker} value=${f.subteams} onChange=${(v) => setF({ ...f, subteams: v })} /></div>
      ${err && html`<p class="form-error full">${err}</p>`}
      <div class="full"><button class="btn btn-primary" type="submit"><${Icon} name="plus" />Add to invite list</button></div>
    </form>
    ${res.loading && !res.data ? html`<${Loading} />` : !(res.data || []).length ? html`<p class="muted">No invites yet.</p>` : html`<div class="panel"><ul class="list list-flush">${res.data.map((inv) => html`<li key=${inv.email}>
      <${Icon} name="mail" size=${20} /><span class="grow"><b>${inv.email}</b><div class="meta">${ROLE[inv.role]}${inv.title ? `, ${inv.title}` : ''}${inv.invitedByName ? `. Added by ${inv.invitedByName}` : ''}</div></span>
      <button class="btn btn-sm btn-quiet" onClick=${() => remove(inv)}>Remove</button></li>`)}</ul></div>`}
  `;
}

// ───────── Subsidiaries and subteams ─────────
function SubteamsAdmin() {
  const { api, profile, subteams, subsidiaries, spaces } = useStore((s) => ({ api: s.api, profile: s.profile, subteams: s.subteams, subsidiaries: s.subsidiaries, spaces: s.spaces }));
  const [subName, setSubName] = useState('');
  const save = async (coll, item, label) => { try { await api.saveRef(coll, item); if (label) toast(label); } catch (e) { toastError(e); } };
  const addSubsidiary = async (e) => {
    e.preventDefault();
    const name = subName.trim();
    if (!name) return;
    const used = new Set(subsidiaries.map((x) => x.color));
    await save('subsidiaries', { name, color: PALETTE_KEYS.find((k) => !used.has(k)) || 'navy', order: subsidiaries.length + 1, discordRole: '' }, 'Subsidiary added.');
    api.log(profile, 'subsidiary.add', `Added subsidiary “${name}”`);
    setSubName('');
  };
  const removeSubsidiary = async (x) => {
    const inUse = subteams.some((t) => t.subsidiaryId === x.id) || spaces.some((sp) => sp.subsidiaryId === x.id);
    if (inUse) { toast(`Move ${x.name}’s subteams and spaces elsewhere first.`, { kind: 'bad' }); return; }
    if (!(await confirmDialog({ title: `Delete ${x.name}?`, body: 'It has no subteams or spaces, so nothing else changes.', confirmLabel: 'Delete', danger: true }))) return;
    try { await api.deleteRef('subsidiaries', x.id); api.log(profile, 'subsidiary.delete', `Deleted subsidiary “${x.name}”`); toast('Deleted.'); } catch (e) { toastError(e); }
  };
  const groups = groupBySubsidiary(subteams, subsidiaries);
  return html`
    <p class="muted" style="margin-top:0;max-width:72ch">Subsidiaries like Crush Depth and Prosthetic group subteams and spaces in the sidebar, the way categories group channels in Discord. Subteams group members and color their hours in reports.</p>
    <p class="small muted" style="margin-top:-6px;max-width:72ch"><b>Discord role:</b> the role’s name (like Chassis) or its ID. When a lead mentions that role and the portal bot in Discord, the announcement is posted here for that subteam, or for every subteam in a subsidiary. Leave it blank to match a Discord role with the same name.</p>
    ${groups.map((g) => html`<section class="panel" key=${g.sub?.id || '-'} style="margin-bottom:16px">
      <div class="panel-head" style="gap:10px;flex-wrap:wrap">
        ${g.sub ? html`<input class="input" style="max-width:240px;font-weight:600" value=${g.sub.name} maxlength="60" aria-label="Subsidiary name"
            onChange=${(e) => e.target.value.trim() && save('subsidiaries', { id: g.sub.id, name: e.target.value.trim() }, 'Renamed.')} />
          <span class="at-field"><span aria-hidden="true">@</span><input class="input" style="max-width:200px" value=${g.sub.discordRole || ''} maxlength="100" placeholder="Discord role" aria-label=${`Discord role for all of ${g.sub.name}`}
            onChange=${(e) => save('subsidiaries', { id: g.sub.id, discordRole: cleanRole(e.target.value) }, 'Discord role saved.')} /></span>
          <span class="spacer"></span>
          <button class="btn btn-sm btn-quiet" onClick=${() => removeSubsidiary(g.sub)}>Delete</button>`
        : html`<h2>Club-wide</h2><span class="small muted">Subteams that don’t belong to a subsidiary</span>`}
      </div>
      ${g.items.length ? html`<ul class="list list-flush">${g.items.map((t) => html`<li key=${t.id} style="align-items:center;flex-wrap:wrap">
        <i style=${{ width: '14px', height: '14px', borderRadius: '4px', background: seriesColor(t.color), flex: 'none' }}></i>
        <input class="input" style="max-width:220px" value=${t.name} maxlength="60" aria-label="Subteam name" onChange=${(e) => e.target.value.trim() && save('subteams', { id: t.id, name: e.target.value.trim() }, 'Renamed.')} />
        <span class="at-field"><span aria-hidden="true">@</span><input class="input" style="max-width:170px" value=${t.discordRole || ''} maxlength="100" placeholder="Discord role" aria-label=${`Discord role for ${subteamLabel(t)}`}
          onChange=${(e) => save('subteams', { id: t.id, discordRole: cleanRole(e.target.value) }, 'Discord role saved.')} /></span>
        <select class="select" style="width:auto" value=${t.subsidiaryId || ''} aria-label=${`Subsidiary for ${t.name}`} onChange=${(e) => save('subteams', { id: t.id, subsidiaryId: e.target.value || null }, 'Moved.')}>
          <option value="">Club-wide</option>${subsidiaries.map((x) => html`<option value=${x.id} key=${x.id}>${x.name}</option>`)}</select>
        <select class="select" style="width:auto" value=${PALETTE_KEYS.includes(t.color) ? t.color : ''} aria-label=${`Color for ${t.name}`} onChange=${(e) => save('subteams', { id: t.id, color: e.target.value })}>
          ${!PALETTE_KEYS.includes(t.color) && html`<option value="">Custom</option>`}${PALETTE_KEYS.map((k) => html`<option value=${k} key=${k}>${k[0].toUpperCase() + k.slice(1)}</option>`)}</select>
        <span class="spacer"></span>
        <button class="btn btn-sm btn-quiet" onClick=${async () => { if (await confirmDialog({ title: `Archive ${subteamLabel(t)}?`, body: 'It disappears from pickers. Past hours keep their subteam in reports.', confirmLabel: 'Archive' })) { save('subteams', { id: t.id, archived: true }, 'Archived.'); api.log(profile, 'subteam.archive', `Archived subteam “${subteamLabel(t)}”`); } }}>Archive</button>
      </li>`)}</ul>` : html`<p class="muted small" style="margin:0;padding:12px 18px">No subteams here yet.</p>`}
      <${AddSubteam} subsidiaryId=${g.sub?.id || null} label=${g.sub?.name || 'club-wide'} />
    </section>`)}
    <form class="row wrap" style="margin-top:4px" onSubmit=${addSubsidiary}>
      <input class="input" style="max-width:320px" placeholder="New subsidiary, e.g. Prosthetic" value=${subName} maxlength="60" onInput=${(e) => setSubName(e.target.value)} />
      <button class="btn" type="submit"><${Icon} name="plus" />Add subsidiary</button></form>`;
}

const cleanRole = (v) => String(v || '').trim().replace(/^@+/, '');

function AddSubteam({ subsidiaryId, label }) {
  const { api, profile, subteams } = useStore((s) => ({ api: s.api, profile: s.profile, subteams: s.subteams }));
  const [name, setName] = useState('');
  const add = async (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    const used = new Set(subteams.filter((t) => (t.subsidiaryId || null) === subsidiaryId).map((t) => t.color));
    try {
      await api.saveRef('subteams', { name: n, subsidiaryId, discordRole: '', color: PALETTE_KEYS.find((k) => !used.has(k)) || 'navy', order: subteams.length + 1 });
      api.log(profile, 'subteam.add', `Added subteam “${n}” (${label})`);
      toast('Subteam added.'); setName('');
    } catch (ex) { toastError(ex); }
  };
  return html`<form class="row wrap" style="padding:12px 18px;border-top:1px solid var(--line)" onSubmit=${add}>
    <input class="input" style="max-width:260px" placeholder="New subteam" aria-label=${`New subteam in ${label}`} value=${name} maxlength="60" onInput=${(e) => setName(e.target.value)} />
    <button class="btn btn-sm" type="submit"><${Icon} name="plus" />Add subteam</button></form>`;
}

// ───────── Activities ─────────
function ActivitiesAdmin() {
  const { api, profile, activities, subteams, subsidiaries } = useStore((s) => ({ api: s.api, profile: s.profile, activities: s.activities, subteams: s.subteams, subsidiaries: s.subsidiaries }));
  const [f, setF] = useState({ name: '', subteamId: '' });
  const teamOptions = groupBySubsidiary(subteams, subsidiaries).filter((g) => g.items.length).map((g) => (g.sub
    ? html`<optgroup label=${g.sub.name} key=${g.sub.id}>${g.items.map((t) => html`<option value=${t.id} key=${t.id}>${t.name}</option>`)}</optgroup>`
    : g.items.map((t) => html`<option value=${t.id} key=${t.id}>${t.name}</option>`)));
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
        <option value="">Everyone</option>${teamOptions}</select>
      <span class="spacer"></span>
      <button class="btn btn-sm btn-quiet" onClick=${() => save({ id: a.id, archived: !a.archived }, a.archived ? 'Restored.' : 'Archived.')}>${a.archived ? 'Restore' : 'Archive'}</button>
    </li>`)}</ul></div>
    <form class="row wrap" style="margin-top:14px" onSubmit=${add}>
      <input class="input" style="max-width:320px" placeholder="New activity, e.g. Pool test" value=${f.name} maxlength="60" onInput=${(e) => setF({ ...f, name: e.target.value })} />
      <select class="select" style="width:auto" value=${f.subteamId} onChange=${(e) => setF({ ...f, subteamId: e.target.value })} aria-label="Subteam"><option value="">Everyone</option>${teamOptions}</select>
      <button class="btn" type="submit"><${Icon} name="plus" />Add activity</button></form>`;
}

// ───────── Spaces ─────────
function SpacesAdmin() {
  const { api, profile, spaces, subsidiaries, contents } = useStore((s) => ({ api: s.api, profile: s.profile, spaces: s.spaces, subsidiaries: s.subsidiaries, contents: s.contents }));
  const rev = useStore((s) => s.rev);
  const members = useAsync(() => api.listMembers(), [api, rev]);
  const pages = (sp) => (contents[sp.id]?.tree || []).length;
  const pagesText = (sp) => (pages(sp) === 1 ? '1 page' : `${pages(sp)} pages`);
  const remove = async (sp) => {
    if (!(await confirmDialog({ title: `Delete #${sp.name}?`, body: `Its ${pagesText(sp)} and its task board are deleted for everyone. Files in Google Drive aren’t touched. This can’t be undone.`, confirmLabel: 'Delete space', danger: true }))) return;
    try { await api.deleteSpace(sp.id); api.log(profile, 'space.delete', `Deleted space #${sp.name} with ${pages(sp)} pages`, { type: 'space', id: sp.id }); toast('Space deleted.'); } catch (e) { toastError(e); }
  };
  const rebuild = async (sp) => { try { const n = await api.rebuildTree(sp.id); toast(`Page list rebuilt: ${n} pages.`); } catch (e) { toastError(e); } };
  const who = (sp) => {
    const n = (members.data || []).filter((m) => m.role !== 'admin' && (m.spaces || []).includes(sp.id)).length;
    return members.data ? `Private: ${n} ${n === 1 ? 'person' : 'people'} and admins` : 'Private';
  };
  const groups = groupBySubsidiary(spaces, subsidiaries).filter((g) => g.items.length || g.sub);
  return html`
    <div class="row" style="margin-bottom:14px"><p class="muted" style="margin:0;flex:1;max-width:72ch">Spaces hold pages, a task board and a linked Google Drive folder. Make a space private to choose exactly who can open it; you can also pick someone’s private spaces from Members.</p>
      <button class="btn btn-primary" onClick=${() => openNewSpace({})}><${Icon} name="plus" />New space</button></div>
    ${groups.map((g) => html`<section key=${g.sub?.id || '-'} style="margin-bottom:18px">
      <div class="row" style="margin-bottom:8px"><h2 class="section-title" style="margin:0;flex:1">${g.sub ? g.sub.name : 'Club-wide'}</h2>
        <button class="btn btn-sm btn-quiet" onClick=${() => openNewSpace({ subsidiaryId: g.sub?.id || '' })}><${Icon} name="plus" />Add a space here</button></div>
      ${g.items.length ? html`<div class="panel"><ul class="list list-flush">${g.items.map((sp) => html`<li key=${sp.id} style="align-items:center">
        <span class="space-glyph"><${SpaceIcon} space=${sp} size=${22} /></span>
        <span class="grow"><a class="title" href=${href('/s/' + sp.id)}>${sp.name}</a>${sp.private && html`<span class="badge badge-plain" style="margin-left:8px"><${Icon} name="lock" size=${12} />${who(sp)}</span>`}
          <div class="meta">${pagesText(sp)}.${sp.memberEdit ? '' : ' Only leads edit.'}${contents[sp.id]?.driveFolder ? ' Drive folder linked.' : ''}</div></span>
        <button class="btn btn-sm" onClick=${() => openSpaceAccess(sp)}><${Icon} name="users" />Who can open it</button>
        <button class="btn btn-sm" onClick=${() => openSpaceSettings(sp)}>Settings</button>
        <${Menu} items=${[{ label: 'Rebuild page list', icon: 'refresh', onClick: () => rebuild(sp) }, { label: 'Delete space', icon: 'trash', danger: true, onClick: () => remove(sp) }]} />
      </li>`)}</ul></div>` : html`<p class="muted small" style="margin:0">No spaces yet.</p>`}
    </section>`)}`;
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
