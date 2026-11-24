// Member directory, profiles, and editing your own profile.
import { html, useState, useMemo, useEffect, Icon, Avatar, Chip, Field, Seg, Loading, Empty, Notice, StatusBadge, useAsync, toast, toastError } from '../lib/ui.js';
import { useStore, setState, getState, isLead, isAdmin, subteamById, activityById } from '../lib/store.js';
import { href, go } from '../lib/router.js';
import { termRange, startOfWeek, addDays, startOfDay, entryMs, hours, fmtHours, fmtDate, fmtRange, fmtDuration, relTime } from '../lib/time.js';
import { seriesColor } from './charts.js';
import { openEntryEditor } from './time.js';
import { openMemberManager } from './admin.js';
import { setTheme, useTitle } from './common.js';

const ROLE = { admin: 'Admin', lead: 'Lead', member: 'Member' };

function useMemberList(includeAll) {
  const api = useStore((s) => s.api);
  const rev = useStore((s) => s.rev);
  return useAsync(async () => {
    const list = await api.listMembers({ includeAll });
    if (!includeAll) setState({ membersCache: list });
    return list;
  }, [api, includeAll, rev]);
}

export function Members() {
  useTitle('Members');
  const { api, profile, subteams, settings } = useStore((s) => ({ api: s.api, profile: s.profile, subteams: s.subteams, settings: s.settings }));
  const lead = isLead(profile);
  const res = useMemberList(false);
  const [q, setQ] = useState('');
  const [sub, setSub] = useState('all');
  const [officers, setOfficers] = useState(false);
  const [termHours, setTermHours] = useState(null);
  const loadHours = async () => {
    try {
      const { from, to } = termRange(settings);
      const entries = await api.listEntries(from, to);
      const m = new Map();
      entries.filter((e) => e.status === 'complete').forEach((e) => m.set(e.uid, (m.get(e.uid) || 0) + entryMs(e)));
      setTermHours(m);
    } catch (e) { toastError(e); }
  };
  const list = (res.data || []).filter((m) => m.status === 'active')
    .filter((m) => sub === 'all' || m.subteams?.includes(sub))
    .filter((m) => !officers || m.role !== 'member' || m.title)
    .filter((m) => !q || [m.name, m.title, m.major, ...(m.skills || [])].some((t) => String(t || '').toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (termHours ? (termHours.get(b.uid) || 0) - (termHours.get(a.uid) || 0) : 0) || a.name.localeCompare(b.name));
  return html`<div class="content">
    <div class="page-head">
      <div><h1>Members</h1><p>${res.data ? `${res.data.filter((m) => m.status === 'active').length} active members.` : ''} Find a teammate by name, subteam or skill.</p></div>
      ${lead && html`<div class="actions"><button class="btn" onClick=${loadHours} disabled=${!!termHours}><${Icon} name="clock" />${termHours ? `Showing ${settings.termName} hours` : `Show ${settings.termName || 'term'} hours`}</button></div>`}
    </div>
    <div class="row wrap" style="gap:10px;margin-bottom:16px">
      <div class="search" style="flex:1;min-width:220px"><${Icon} name="search" /><input class="input" type="search" placeholder="Search names, skills, majors" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
      <select class="select" style="width:auto" value=${sub} onChange=${(e) => setSub(e.target.value)} aria-label="Subteam">
        <option value="all">All subteams</option>${subteams.map((s) => html`<option value=${s.id} key=${s.id}>${s.name}</option>`)}</select>
      <label class="check small"><input type="checkbox" checked=${officers} onChange=${(e) => setOfficers(e.target.checked)} />Officers and leads only</label>
    </div>
    ${res.loading && !res.data ? html`<${Loading} />` : !list.length ? html`<div class="panel"><${Empty} title="Nobody matches">Try a different search or subteam.</${Empty}></div>`
    : html`<div class="panel"><ul class="list list-flush">${list.map((m) => html`<li key=${m.uid} style="align-items:center">
        <${Avatar} person=${m} size=${40} />
        <span class="grow"><a class="title" href=${href('/members/' + m.uid)}>${m.name}</a>${m.pronouns && html` <span class="small muted">(${m.pronouns})</span>`}
          <div class="meta">${m.title || (m.role !== 'member' ? ROLE[m.role] : m.major || 'Member')}</div></span>
        <span class="chips" style="justify-content:flex-end">${(m.subteams || []).map((id) => subteamById(id) && html`<${Chip} key=${id} color=${seriesColor(subteamById(id).color)}>${subteamById(id).name}</${Chip}>`)}</span>
        ${termHours && html`<span class="num" style="min-width:64px;text-align:right">${fmtHours(hours(termHours.get(m.uid) || 0))} h</span>`}
      </li>`)}</ul></div>`}
  </div>`;
}

export function MemberProfile({ uid }) {
  const { api, profile, settings } = useStore((s) => ({ api: s.api, profile: s.profile, settings: s.settings }));
  const lead = isLead(profile), admin = isAdmin(profile);
  const res = useMemberList(lead);
  const m = (res.data || []).find((x) => x.uid === uid);
  useTitle(m?.name || 'Member');
  const self = uid === profile.uid;
  const term = termRange(settings);
  const rev = useStore((s) => s.rev);
  const entries = useAsync(() => (lead || self) ? api.listMyEntries(uid, term.from, addDays(startOfDay(new Date()), 1)) : Promise.resolve(null), [api, uid, lead, rev]);
  if (res.loading && !res.data) return html`<div class="content"><${Loading} /></div>`;
  if (!m) return html`<div class="content"><${Empty} title="Member not found">They may have left the club, or their account is waiting for approval.</${Empty}></div>`;
  const links = Object.fromEntries(Object.entries(m.links || {}).filter(([, v]) => typeof v === 'string' && /^https:\/\/\S+$/.test(v)));
  const ent = entries.data || [];
  const counted = ent.filter((e) => e.status === 'complete');
  const week = counted.filter((e) => new Date(e.start) >= startOfWeek(new Date())).reduce((s, e) => s + entryMs(e), 0);
  const termMs = counted.reduce((s, e) => s + entryMs(e), 0);
  return html`<div class="content">
    <div class="crumbs"><a href="#/members">Members</a><${Icon} name="chevronRight" /><span>${m.name}</span></div>
    <section class="panel panel-pad">
      <div class="row wrap" style="gap:18px;align-items:flex-start">
        <${Avatar} person=${m} size=${84} />
        <div style="flex:1;min-width:220px">
          <h1 style="margin:0;font-size:28px;letter-spacing:-.01em">${m.name}${m.pronouns && html` <span class="small muted" style="font-weight:500">(${m.pronouns})</span>`}</h1>
          <div class="muted" style="margin-top:2px">${m.title || ROLE[m.role]}${m.major ? `, ${m.major}` : ''}</div>
          <div class="chips" style="margin-top:10px">${m.role !== 'member' && html`<span class="badge badge-info">${ROLE[m.role]}</span>`}
            ${m.status !== 'active' && html`<span class="badge badge-warn">${m.status}</span>`}
            ${(m.subteams || []).map((id) => subteamById(id) && html`<${Chip} key=${id} color=${seriesColor(subteamById(id).color)}>${subteamById(id).name}</${Chip}>`)}</div>
          <div class="row wrap" style="gap:8px;margin-top:14px">
            <a class="btn btn-sm" href=${'mailto:' + m.email}><${Icon} name="mail" />${m.email}</a>
            ${links.linkedin && html`<a class="btn btn-sm" href=${links.linkedin} target="_blank" rel="noopener noreferrer"><${Icon} name="external" />LinkedIn</a>`}
            ${links.github && html`<a class="btn btn-sm" href=${links.github} target="_blank" rel="noopener noreferrer"><${Icon} name="external" />GitHub</a>`}
            ${links.website && html`<a class="btn btn-sm" href=${links.website} target="_blank" rel="noopener noreferrer"><${Icon} name="external" />Website</a>`}
          </div>
        </div>
        <div class="row wrap" style="gap:8px">
          ${self && html`<a class="btn btn-primary" href="#/profile"><${Icon} name="edit" />Edit profile</a>`}
          ${admin && html`<button class="btn" onClick=${() => openMemberManager(m)}><${Icon} name="shield" />Manage</button>`}
        </div>
      </div>
      ${m.bio && html`<p style="margin:18px 0 0;max-width:70ch">${m.bio}</p>`}
      ${m.skills?.length > 0 && html`<div class="chips" style="margin-top:14px">${m.skills.map((s) => html`<span class="chip" key=${s}>${s}</span>`)}</div>`}
    </section>

    ${(lead || self) && html`<section class="panel" style="margin-top:16px">
      <div class="panel-head"><h2>Hours</h2>
        <div class="row" style="gap:6px">${lead && !self && html`<button class="btn btn-sm" onClick=${() => openEntryEditor(null)}><${Icon} name="plus" />Add a session</button>`}
          ${lead && html`<button class="btn btn-sm" onClick=${() => { try { const f = JSON.parse(localStorage.getItem('er-report-filters') || '{}'); localStorage.setItem('er-report-filters', JSON.stringify({ ...f, members: [uid], groupBy: 'activity' })); } catch { /* ignore */ } go('/reports'); }}><${Icon} name="chart" />Open in Reports</button>`}</div></div>
      ${entries.loading && !entries.data ? html`<div class="panel-body"><${Loading} /></div>` : html`
        <div class="readouts">
          <div class="readout"><div class="v">${fmtHours(hours(week))}<small>h</small></div><div class="k">This week</div></div>
          <div class="readout"><div class="v">${fmtHours(hours(termMs))}<small>h</small></div><div class="k">${settings.termName || 'This term'}</div></div>
          <div class="readout"><div class="v">${counted.length}</div><div class="k">Sessions</div></div>
        </div>
        <ul class="list list-flush" style="border-top:1px solid var(--line)">${ent.slice().sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 8).map((e) => html`<li key=${e.id}>
          <span class="grow"><span class="title">${fmtDate(e.start)}</span> <span class="muted small">${fmtRange(e.start, e.end)}</span>
            <div class="meta">${activityById(e.activityId)?.name || 'No activity'}</div></span>
          ${e.status !== 'complete' && html`<${StatusBadge} status=${e.status} />`}
          <span class="num small">${e.status === 'open' ? 'now' : fmtDuration(entryMs(e))}</span>
          ${lead && !self && html`<button class="btn btn-sm btn-quiet btn-icon" aria-label="Edit session" onClick=${() => openEntryEditor(e)}><${Icon} name="edit" size=${16} /></button>`}
        </li>`)}</ul>`}
    </section>`}
  </div>`;
}

const httpsOrEmpty = (s) => !s || /^https:\/\/[^\s]+$/.test(s);

export function EditProfile() {
  useTitle('Your profile');
  const { api, profile, subteams, theme } = useStore((s) => ({ api: s.api, profile: s.profile, subteams: s.subteams, theme: s.theme }));
  const [f, setF] = useState({
    name: profile.name || '', pronouns: profile.pronouns || '', major: profile.major || '', bio: profile.bio || '',
    skills: (profile.skills || []).join(', '), linkedin: profile.links?.linkedin || '', github: profile.links?.github || '', website: profile.links?.website || '',
    subteams: profile.subteams || [],
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) return setErr('Your name can’t be empty.');
    if (![f.linkedin, f.github, f.website].every(httpsOrEmpty)) return setErr('Links need to start with https://');
    setBusy(true); setErr('');
    try {
      const links = {};
      if (f.linkedin) links.linkedin = f.linkedin.trim();
      if (f.github) links.github = f.github.trim();
      if (f.website) links.website = f.website.trim();
      await api.updateMyProfile(profile.uid, {
        name: f.name.trim().slice(0, 80), pronouns: f.pronouns.trim().slice(0, 30), major: f.major.trim().slice(0, 80), bio: f.bio.trim().slice(0, 1000),
        skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 25).map((s) => s.slice(0, 40)), links, subteams: f.subteams.slice(0, 10),
      });
      setState({ membersCache: null });
      toast('Profile saved.');
    } catch (ex) { toastError(ex); }
    setBusy(false);
  };
  return html`<div class="content doc">
    <div class="page-head"><div><h1>Your profile</h1><p>This is what other members see in the directory.</p></div>
      <div class="actions"><a class="btn" href=${href('/members/' + profile.uid)}>View profile</a></div></div>
    <form class="panel panel-pad" onSubmit=${save}>
      <div class="row" style="gap:14px;margin-bottom:18px"><${Avatar} person=${profile} size=${56} />
        <div><b>${profile.email}</b><div class="small muted">Your photo and email come from your Google account. ${ROLE[profile.role]}${profile.title ? `, ${profile.title}` : ''}.</div></div></div>
      <div class="form-grid">
        <${Field} label="Name"><input class="input" value=${f.name} maxlength="80" onInput=${set('name')} required /></${Field}>
        <${Field} label="Pronouns"><input class="input" value=${f.pronouns} maxlength="30" onInput=${set('pronouns')} /></${Field}>
        <${Field} label="Major" full><input class="input" value=${f.major} maxlength="80" onInput=${set('major')} /></${Field}>
        <${Field} label="About you" full><textarea class="textarea" value=${f.bio} maxlength="1000" onInput=${set('bio')} placeholder="What you work on, what you want to learn"></textarea></${Field}>
        <${Field} label="Skills" full hint="Separate with commas: SolidWorks, Arduino, Python"><input class="input" value=${f.skills} onInput=${set('skills')} /></${Field}>
        <div class="field full"><span>Subteams</span><div class="chips">${subteams.map((s) => html`<button type="button" key=${s.id} class="chip chip-toggle" aria-pressed=${String(f.subteams.includes(s.id))}
          onClick=${() => setF({ ...f, subteams: f.subteams.includes(s.id) ? f.subteams.filter((x) => x !== s.id) : [...f.subteams, s.id] })}>${s.name}</button>`)}</div></div>
        <${Field} label="LinkedIn"><input class="input" type="url" value=${f.linkedin} placeholder="https://linkedin.com/in/…" onInput=${set('linkedin')} /></${Field}>
        <${Field} label="GitHub"><input class="input" type="url" value=${f.github} placeholder="https://github.com/…" onInput=${set('github')} /></${Field}>
        <${Field} label="Website or portfolio" full><input class="input" type="url" value=${f.website} placeholder="https://…" onInput=${set('website')} /></${Field}>
      </div>
      ${err && html`<p class="form-error" role="alert">${err}</p>`}
      <div class="row" style="margin-top:18px"><button class="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Saving…' : 'Save profile'}</button></div>
    </form>
    <section class="panel panel-pad" style="margin-top:16px">
      <h2 style="margin:0 0 10px;font-size:16px">Appearance</h2>
      <${Seg} label="Theme" value=${theme} onChange=${setTheme} options=${[['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']]} />
    </section>
    <section class="panel panel-pad" style="margin-top:16px">
      <h2 style="margin:0 0 6px;font-size:16px">Sign out</h2>
      <p class="small muted" style="margin:0 0 12px">On a shared computer, sign out when you’re done.</p>
      <button class="btn" onClick=${() => api.signOut()}><${Icon} name="logout" />Sign out</button>
    </section>
  </div>`;
}
