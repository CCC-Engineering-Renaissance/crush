// My time (every member) and Approvals (leads).
import { html, useState, useMemo, Icon, Avatar, Modal, openModal, Field, Seg, Menu, StatusBadge, Chip, Loading, Empty, Notice, useAsync, toast, toastError, confirmDialog } from '../lib/ui.js';
import { useStore, setState, getState, isLead, isAdmin, activityById, subteamById, subteamLabel, bump } from '../lib/store.js';
import { href } from '../lib/router.js';
import {
  presetRange, startOfDay, addDays, isoDate, parseIsoDate, fmtDate, fmtTime, fmtRange, fmtDuration, fmtHours, hours, entryMs,
  startOfWeek, fmtShortDate, toLocalInput, fromLocalInput, combine, timeInput, HOUR, DAY, sameDay, fmtDateTime,
} from '../lib/time.js';
import { downloadCsv } from '../lib/csv.js';
import { plural } from '../lib/text.js';
import { ColumnChart, seriesColor } from './charts.js';
import { useTitle } from './common.js';

export function TimeView({ tab }) {
  useTitle(tab === 'approvals' ? 'Approvals' : 'My time');
  const { profile, pendingFixes } = useStore((s) => ({ profile: s.profile, pendingFixes: s.pendingFixes }));
  const lead = isLead(profile);
  const showApprovals = lead && tab === 'approvals';
  return html`<div class="content">
    <div class="page-head">
      <div><h1>${showApprovals ? 'Approvals' : 'My time'}</h1>
        <p>${showApprovals ? 'Sessions members asked you to fix, and anyone still clocked in from earlier.' : 'Every session you’ve clocked and what counts toward your hours.'}</p></div>
      ${lead && html`<div class="actions"><button class="btn" onClick=${() => openEntryEditor(null)}><${Icon} name="plus" />Add a session for someone</button></div>`}
    </div>
    ${lead && html`<nav class="tabs" aria-label="Time sections">
      <a href="#/time" aria-current=${!showApprovals ? 'page' : undefined}>My sessions</a>
      <a href="#/time/approvals" aria-current=${showApprovals ? 'page' : undefined}>Approvals${pendingFixes.length ? html`<span class="badge badge-warn">${pendingFixes.length}</span>` : ''}</a>
    </nav>`}
    ${showApprovals ? html`<${Approvals} />` : html`<${MySessions} />`}
  </div>`;
}

// ───────── My sessions ─────────
function MySessions() {
  const { api, profile, settings } = useStore((s) => ({ api: s.api, profile: s.profile, settings: s.settings }));
  const presenceKey = useStore((s) => s.presence.find((p) => p.uid === s.profile?.uid)?.entryId || 'none');
  const rev = useStore((s) => s.rev);
  const [preset, setPreset] = useState('term');
  const [custom, setCustom] = useState({ from: isoDate(addDays(new Date(), -13)), to: isoDate(new Date()) });
  const range = preset === 'custom'
    ? { from: parseIsoDate(custom.from) || addDays(startOfDay(new Date()), -13), to: addDays(parseIsoDate(custom.to) || startOfDay(new Date()), 1) }
    : presetRange(preset, settings);
  const res = useAsync(() => api.listMyEntries(profile.uid, range.from, range.to), [api, profile.uid, range.from.getTime(), range.to.getTime(), presenceKey, rev]);
  const entries = res.data || [];

  const stats = useMemo(() => {
    let counted = 0, n = 0, waiting = 0;
    entries.forEach((e) => { if (e.status === 'complete') { counted += entryMs(e); n++; } else if (e.status === 'pending') waiting += entryMs(e); });
    return { counted, n, waiting, avg: n ? counted / n : 0 };
  }, [entries]);

  const chart = useMemo(() => fillTimeline(buildTimeline([], range), entries.filter((e) => e.status === 'complete'), () => 'h'), [entries, range.from.getTime(), range.to.getTime()]);
  const days = useMemo(() => {
    const map = new Map();
    entries.slice().sort((a, b) => new Date(b.start) - new Date(a.start)).forEach((e) => {
      const k = isoDate(e.start);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    });
    return [...map.entries()];
  }, [entries]);

  const exportCsv = () => downloadCsv(`my-hours-${isoDate(range.from)}-to-${isoDate(addDays(range.to, -1))}.csv`, [
    ['Date', 'Start', 'End', 'Hours', 'Status', 'Activity', 'Subteam', 'Note', 'What I got done'],
    ...entries.map((e) => [isoDate(e.start), fmtTime(e.start), e.end ? fmtTime(e.end) : '', fmtHours(hours(entryMs(e)), 2), e.status, activityById(e.activityId)?.name || '', subteamLabel(e.subteamId), e.note || '', e.outNote || '']),
  ]);

  return html`
    <div class="row wrap" style="margin-bottom:16px;gap:12px">
      <${Seg} label="Date range" value=${preset} onChange=${setPreset} options=${[['week', 'This week'], ['30', 'Last 30 days'], ['term', settings.termName || 'This term'], ['custom', 'Custom']]} />
      ${preset === 'custom' && html`<div class="row" style="gap:8px">
        <input class="input" type="date" style="width:auto" value=${custom.from} onInput=${(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
        <span class="muted">to</span>
        <input class="input" type="date" style="width:auto" value=${custom.to} onInput=${(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" /></div>`}
      <span class="spacer"></span>
      <button class="btn btn-sm" onClick=${exportCsv} disabled=${!entries.length}><${Icon} name="download" />Download CSV</button>
    </div>
    <section class="panel">
      <div class="readouts">
        <div class="readout"><div class="v">${fmtHours(hours(stats.counted))}<small>h</small></div><div class="k">Counted hours</div></div>
        <div class="readout"><div class="v">${stats.n}</div><div class="k">Sessions</div></div>
        <div class="readout"><div class="v">${fmtHours(hours(stats.avg))}<small>h</small></div><div class="k">Average session</div></div>
        <div class="readout"><div class="v">${fmtHours(hours(stats.waiting))}<small>h</small></div><div class="k">Waiting for approval</div></div>
      </div>
      ${chart.points.length > 1 && html`<div class="panel-body" style="border-top:1px solid var(--line);padding-top:16px">
        <div class="small strong" style="margin-bottom:8px">Counted hours per ${chart.unit}</div>
        <${ColumnChart} points=${chart.points} series=${[{ key: 'h', label: 'Hours', color: 'navy' }]} title=${'Counted hours per ' + chart.unit} />
      </div>`}
    </section>
    <h2 class="section-title">Sessions</h2>
    ${res.loading && !res.data ? html`<${Loading} />` : !entries.length
      ? html`<div class="panel"><${Empty} title="No sessions in this range">Clock in from Home when you start working. Your sessions show up here.</${Empty}></div>`
      : html`<div class="panel"><ul class="list list-flush">${days.map(([day, list]) => html`
          <li class="day-head" key=${'d' + day}><span class="grow">${fmtDate(parseIsoDate(day))}</span>
            <span class="num small muted">${fmtHours(hours(list.filter((e) => e.status === 'complete').reduce((s, e) => s + entryMs(e), 0)))} h counted</span></li>
          ${list.map((e) => html`<${SessionRow} key=${e.id} e=${e} />`)}`)}</ul></div>`}
  `;
}

export function buildTimeline(entries, range) {
  const spanDays = Math.round((range.to - range.from) / DAY);
  const byWeek = spanDays > 21;
  const unit = byWeek ? 'week' : 'day';
  const points = [];
  let cur = byWeek ? startOfWeek(range.from) : startOfDay(range.from);
  const index = new Map();
  while (cur < range.to) {
    const key = isoDate(cur);
    index.set(key, points.length);
    points.push({ key, label: fmtShortDate(cur), long: byWeek ? `Week of ${fmtShortDate(cur)}` : fmtDate(cur), values: {} });
    cur = addDays(cur, byWeek ? 7 : 1);
    if (points.length > 120) break;
  }
  return { unit, points, index, byWeek };
}
function bucketKey(d, byWeek) { return isoDate(byWeek ? startOfWeek(d) : startOfDay(d)); }

// Re-used by Reports: fill a timeline with values per series.
export function fillTimeline(tl, entries, seriesOf) {
  entries.forEach((e) => {
    const i = tl.index.get(bucketKey(e.start, tl.byWeek));
    if (i == null) return;
    const k = seriesOf(e);
    tl.points[i].values[k] = (tl.points[i].values[k] || 0) + hours(entryMs(e));
  });
  return tl;
}

function SessionRow({ e }) {
  const act = activityById(e.activityId);
  const sub = subteamById(e.subteamId);
  const items = [e.status !== 'rejected' && { label: 'Change what you worked on', icon: 'edit', onClick: () => openDetailsEditor(e) }];
  return html`<li>
    <span class="grow">
      <div class="row wrap" style="gap:8px"><span class="title">${fmtRange(e.start, e.end)}</span>
        <span class="num small muted">${e.status === 'open' ? 'in progress' : fmtDuration(entryMs(e))}</span>
        ${e.status !== 'complete' && html`<${StatusBadge} status=${e.status} />`}
        ${e.geo === 'off-site' && html`<span class="badge badge-plain" title="Clocked in away from the lab"><${Icon} name="mapPin" size=${12} />Away from lab</span>`}
        ${e.source === 'lead' && html`<span class="badge badge-plain">Added by a lead</span>`}</div>
      <div class="meta">${act ? act.name : 'No activity'}${sub ? html` <${Chip} color=${seriesColor(sub.color)}>${subteamLabel(sub)}</${Chip}>` : ''}</div>
      ${e.note && html`<div class="small" style="margin-top:4px">${e.note}</div>`}
      ${e.outNote && html`<div class="small" style="margin-top:4px;color:var(--text-2)">Got done: ${e.outNote}</div>`}
      ${e.fix?.reason && html`<div class="small" style="margin-top:4px;color:var(--text-2)">Your fix note: ${e.fix.reason}</div>`}
      ${e.reviewNote && html`<div class="small" style="margin-top:4px;color:var(--text-2)">From the lead: ${e.reviewNote}</div>`}
    </span>
    <${Menu} items=${items} label="Session actions" />
  </li>`;
}

function openDetailsEditor(e) {
  openModal((close) => html`<${DetailsEditor} entry=${e} close=${close} />`);
}
function DetailsEditor({ entry, close }) {
  const { api, activities, profile } = useStore((s) => ({ api: s.api, activities: s.activities, profile: s.profile }));
  const [f, setF] = useState({ activityId: entry.activityId || '', note: entry.note || '', outNote: entry.outNote || '' });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const act = activityById(f.activityId);
      await api.updateEntryDetails(entry.id, { activityId: f.activityId || null, subteamId: act?.subteamId || entry.subteamId || profile.subteams?.[0] || null, note: f.note.trim(), outNote: f.outNote.trim() });
      toast('Session updated.'); bump(); close();
    } catch (e) { toastError(e); setBusy(false); }
  };
  return html`<${Modal} title="Change what you worked on" onClose=${close}
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>Save</button>`}>
    <p class="small muted" style="margin-top:0">${fmtDate(entry.start)}, ${fmtRange(entry.start, entry.end)}. Times can only be changed by a lead.</p>
    <div class="stack">
      <${Field} label="Activity"><select class="select" value=${f.activityId} onChange=${(e) => setF({ ...f, activityId: e.target.value })}>
        <option value="">No activity</option>${activities.filter((a) => !a.archived || a.id === f.activityId).map((a) => html`<option value=${a.id} key=${a.id}>${a.name}</option>`)}</select></${Field}>
      <${Field} label="Note"><input class="input" value=${f.note} maxlength="500" onInput=${(e) => setF({ ...f, note: e.target.value })} /></${Field}>
      <${Field} label="What you got done"><input class="input" value=${f.outNote} maxlength="500" onInput=${(e) => setF({ ...f, outNote: e.target.value })} /></${Field}>
    </div>
  </${Modal}>`;
}

// ───────── Approvals (leads) ─────────
function Approvals() {
  const { api, profile, pendingFixes, presence, settings } = useStore((s) => ({ api: s.api, profile: s.profile, pendingFixes: s.pendingFixes, presence: s.presence, settings: s.settings }));
  const admin = isAdmin(profile);
  const stale = presence.filter((p) => Date.now() - new Date(p.start) > (settings.maxSessionHours || 10) * HOUR);
  const fixes = pendingFixes.slice().sort((a, b) => new Date(a.fix?.requestedAt || a.start) - new Date(b.fix?.requestedAt || b.start));

  const decide = async (e, status, extra = {}) => {
    try {
      await api.leadSaveEntry({ id: e.id, status, reviewedBy: profile.uid, reviewedAt: new Date(), reviewNote: extra.reviewNote || '', ...(extra.end ? { end: extra.end } : {}) }, profile);
      api.log(profile, status === 'complete' ? 'entry.approve' : 'entry.reject', `${status === 'complete' ? 'Approved' : 'Didn’t count'} ${e.name}’s session on ${fmtDate(e.start)} (${fmtDuration(entryMs({ ...e, ...(extra.end ? { end: extra.end } : {}) }))})`, { type: 'timeEntry', id: e.id });
      bump();
      toast(status === 'complete' ? `Approved ${e.name.split(' ')[0]}’s session.` : `Marked ${e.name.split(' ')[0]}’s session as not counted.`);
    } catch (err) { toastError(err); }
  };
  const reject = (e) => openModal((close) => html`<${RejectDialog} entry=${e} close=${close} onConfirm=${(note) => decide(e, 'rejected', { reviewNote: note })} />`);

  return html`
    <h2 class="section-title" style="margin-top:0">Fix requests</h2>
    ${!fixes.length ? html`<div class="panel"><${Empty} title="Nothing to approve">When someone forgets to clock out, their fix request shows up here.</${Empty}></div>`
    : html`<div class="panel"><ul class="list list-flush">${fixes.map((e) => {
        const own = e.uid === profile.uid && !admin;
        return html`<li key=${e.id}>
          <${Avatar} person=${{ uid: e.uid, name: e.name }} size=${34} />
          <span class="grow">
            <div class="row wrap" style="gap:8px"><a class="title" href=${href('/members/' + e.uid)}>${e.name}</a><span class="muted small">${fmtDate(e.start)}</span></div>
            <div class="small">Clocked in at ${fmtTime(e.start)}, says they left at ${fmtTime(e.end)}${!sameDay(e.start, e.end) ? ` on ${fmtDate(e.end)}` : ''}: <b class="num">${fmtDuration(entryMs(e))}</b></div>
            ${e.fix?.reason && html`<div class="small" style="margin-top:2px;color:var(--text-2)">“${e.fix.reason}”</div>`}
            ${own && html`<div class="tiny" style="margin-top:4px;color:var(--warn)">This is your session. Another lead or an admin approves it.</div>`}
          </span>
          ${!own && html`<div class="row wrap" style="gap:6px;justify-content:flex-end">
            <button class="btn btn-sm btn-primary" onClick=${() => decide(e, 'complete')}><${Icon} name="check" />Approve</button>
            <button class="btn btn-sm" onClick=${() => openEntryEditor(e, { approving: true })}>Adjust</button>
            <button class="btn btn-sm btn-quiet" onClick=${() => reject(e)}>Don’t count</button>
          </div>`}
        </li>`;
      })}</ul></div>`}

    <h2 class="section-title">Still clocked in from earlier</h2>
    ${!stale.length ? html`<p class="muted">Nobody has been clocked in for more than ${settings.maxSessionHours} hours.</p>`
    : html`<div class="panel"><ul class="list list-flush">${stale.map((p) => html`<li key=${p.uid}>
        <${Avatar} person=${p} size=${34} />
        <span class="grow"><a class="title" href=${href('/members/' + p.uid)}>${p.name}</a>
          <div class="meta">Clocked in ${fmtDateTime(p.start)}. They’ll be asked to fix it next time they open the portal.</div></span>
        <button class="btn btn-sm" onClick=${async () => { const e = await api.getEntry(p.entryId); if (e) openEntryEditor(e, { closing: true }); }}>Close session</button>
      </li>`)}</ul></div>`}
  `;
}

function RejectDialog({ entry, close, onConfirm }) {
  const [note, setNote] = useState('');
  return html`<${Modal} title="Don’t count this session?" onClose=${close}
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-danger" onClick=${() => { onConfirm(note.trim()); close(); }}>Don’t count it</button>`}>
    <p style="margin-top:0;color:var(--text-2)">${entry.name}’s ${fmtDuration(entryMs(entry))} session on ${fmtDate(entry.start)} won’t count toward their hours. They’ll see your note.</p>
    <${Field} label="Note for ${entry.name.split(' ')[0]}"><input class="input" value=${note} maxlength="400" placeholder="The lab closed at 6, ask me to add the real time" onInput=${(e) => setNote(e.target.value)} /></${Field}>
  </${Modal}>`;
}

// ───────── Lead editor: add, adjust or close a session ─────────
export function openEntryEditor(entry, opts = {}) {
  openModal((close) => html`<${EntryEditor} entry=${entry} close=${close} ...${opts} />`);
}

function EntryEditor({ entry, close, approving, closing }) {
  const { api, profile, activities, presence } = useStore((s) => ({ api: s.api, profile: s.profile, activities: s.activities, presence: s.presence }));
  const members = useAsync(() => getState().membersCache ? getState().membersCache : api.listMembers().then((m) => { setState({ membersCache: m }); return m; }), [api]);
  const isNew = !entry;
  const start0 = entry ? new Date(entry.start) : (() => { const d = new Date(); d.setHours(17, 0, 0, 0); return d; })();
  const end0 = entry?.end ? new Date(entry.end) : new Date(Math.min(Date.now(), start0.getTime() + 2 * HOUR));
  const [f, setF] = useState({
    uid: entry?.uid || '', date: isoDate(start0), start: timeInput(start0), endDate: isoDate(end0), end: timeInput(end0),
    activityId: entry?.activityId || '', note: entry?.note || '', status: approving || closing ? 'complete' : (entry?.status || 'complete'), reviewNote: entry?.reviewNote || '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const start = combine(f.date, f.start), end = combine(f.endDate, f.end);
    if (!start || !end) return setErr('Fill in the start and end.');
    if (end <= start) return setErr('The end has to be after the start.');
    if (end > new Date(Date.now() + HOUR)) return setErr('The end can’t be in the future.');
    if (isNew && !f.uid) return setErr('Pick a member.');
    if (isNew && f.uid === profile.uid && !isAdmin(profile)) return setErr('Another lead adds sessions for you.');
    setBusy(true); setErr('');
    const act = activityById(f.activityId);
    const who = isNew ? (members.data || []).find((m) => m.uid === f.uid) : null;
    try {
      if (isNew) {
        await api.leadSaveEntry({ uid: f.uid, name: who?.name || 'Member', start, end, activityId: f.activityId || null, subteamId: act?.subteamId || who?.subteams?.[0] || null, eventId: null, note: f.note.trim(), outNote: '', reviewNote: f.reviewNote.trim() }, profile);
        api.log(profile, 'entry.add', `Added a ${fmtDuration(end - start)} session for ${who?.name} on ${fmtDate(start)}`, { type: 'timeEntry' });
        toast(`Added a session for ${who?.name?.split(' ')[0] || 'them'}.`);
      } else {
        const p = presence.find((x) => x.uid === entry.uid && x.entryId === entry.id);
        await api.leadSaveEntry({
          id: entry.id, start, end, activityId: f.activityId || null, subteamId: act?.subteamId || entry.subteamId || null, note: f.note.trim(),
          status: f.status, reviewNote: f.reviewNote.trim(), reviewedBy: profile.uid, reviewedAt: new Date(),
        }, profile, { clearPresenceOf: p ? entry.uid : null });
        api.log(profile, closing ? 'entry.close' : approving ? 'entry.approve' : 'entry.edit', `${closing ? 'Closed' : approving ? 'Adjusted and approved' : 'Edited'} ${entry.name}’s session on ${fmtDate(start)}: ${fmtRange(start, end)} (${f.status})`, { type: 'timeEntry', id: entry.id });
        toast('Session saved.');
      }
      bump();
      close();
    } catch (e) { toastError(e); setBusy(false); }
  };

  const title = isNew ? 'Add a session' : closing ? `Close ${entry.name.split(' ')[0]}’s session` : approving ? `Adjust ${entry.name.split(' ')[0]}’s session` : `Edit ${entry.name.split(' ')[0]}’s session`;
  return html`<${Modal} title=${title} onClose=${close}
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>${approving ? 'Save and approve' : 'Save session'}</button>`}>
    ${entry?.fix?.reason && html`<${Notice} kind="info">${entry.name.split(' ')[0]} wrote: “${entry.fix.reason}”</${Notice}>`}
    <div class="form-grid" style="margin-top:12px">
      ${isNew && html`<${Field} label="Member" full>${members.loading && !members.data ? html`<${Loading} />` : html`<select class="select" value=${f.uid} onChange=${set('uid')}>
        <option value="">Choose a member</option>${(members.data || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((m) => html`<option value=${m.uid} key=${m.uid}>${m.name}</option>`)}</select>`}</${Field}>`}
      <${Field} label="Start date"><input class="input" type="date" value=${f.date} onInput=${(e) => setF({ ...f, date: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })} /></${Field}>
      <${Field} label="Start time"><input class="input" type="time" value=${f.start} onInput=${set('start')} /></${Field}>
      <${Field} label="End date"><input class="input" type="date" value=${f.endDate} onInput=${set('endDate')} /></${Field}>
      <${Field} label="End time"><input class="input" type="time" value=${f.end} onInput=${set('end')} /></${Field}>
      <${Field} label="Activity" full><select class="select" value=${f.activityId} onChange=${set('activityId')}>
        <option value="">No activity</option>${activities.filter((a) => !a.archived || a.id === f.activityId).map((a) => html`<option value=${a.id} key=${a.id}>${a.name}</option>`)}</select></${Field}>
      <${Field} label="Note" full><input class="input" value=${f.note} maxlength="500" onInput=${set('note')} /></${Field}>
      ${!isNew && html`<${Field} label="Counts toward hours?"><select class="select" value=${f.status} onChange=${set('status')}>
        <option value="complete">Yes, count it</option><option value="pending">Not yet, waiting</option><option value="rejected">No, don’t count it</option></select></${Field}>`}
      <${Field} label="Note for the member (optional)" full><input class="input" value=${f.reviewNote} maxlength="400" onInput=${set('reviewNote')} /></${Field}>
    </div>
    ${err && html`<p class="form-error" role="alert">${err}</p>`}
  </${Modal}>`;
}
