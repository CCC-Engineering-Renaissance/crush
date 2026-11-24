// Reports (leads and admins): filter sessions by any combination of criteria, group them,
// chart them, and export to CSV or Google Sheets.
import { html, useState, useMemo, useEffect, Icon, Field, MultiSelect, Seg, Loading, Empty, Notice, Menu, StatusBadge, useAsync, toast, toastError, openModal, Modal, Avatar } from '../lib/ui.js';
import { useStore, setState, getState, activityById, subteamById } from '../lib/store.js';
import { href } from '../lib/router.js';
import {
  presetRange, RANGE_PRESETS, isoDate, parseIsoDate, addDays, startOfDay, fmtDate, fmtShortDate, fmtTime, fmtRange, fmtDuration,
  fmtHours, hours, entryMs, weekKey, startOfWeek,
} from '../lib/time.js';
import { toCsv, downloadCsv } from '../lib/csv.js';
import { plural } from '../lib/text.js';
import { BarList, ColumnChart, seriesColor } from './charts.js';
import { buildTimeline, fillTimeline, openEntryEditor } from './time.js';
import { driveConfigured, exportToSheets } from '../google/drive.js';
import { useTitle } from './common.js';

const GROUPS = [['member', 'Member'], ['subteam', 'Subteam'], ['activity', 'Activity'], ['event', 'Event'], ['week', 'Week'], ['day', 'Day']];
const STATUSES = [{ value: 'complete', label: 'Counted' }, { value: 'pending', label: 'Waiting for approval' }, { value: 'rejected', label: 'Not counted' }, { value: 'open', label: 'Still clocked in' }];
const SOURCES = [{ value: 'clock', label: 'Clocked in by the member' }, { value: 'lead', label: 'Added by a lead' }];
const GEO = [{ value: 'on-site', label: 'At the lab' }, { value: 'off-site', label: 'Away from the lab' }, { value: 'unknown', label: 'Location unknown' }, { value: 'none', label: 'No location check' }];
const DEFAULTS = { preset: 'term', from: '', to: '', members: [], subteams: [], activities: [], events: [], statuses: ['complete'], sources: [], geo: [], q: '', groupBy: 'member' };

function loadFilters() {
  let f;
  try { f = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('er-report-filters') || '{}') }; } catch { f = { ...DEFAULTS }; }
  if (!GROUPS.some(([k]) => k === f.groupBy)) f.groupBy = 'member';
  for (const k of ['members', 'subteams', 'activities', 'events', 'statuses', 'sources', 'geo']) if (!Array.isArray(f[k])) f[k] = DEFAULTS[k];
  return f;
}
function loadViews() { try { return JSON.parse(localStorage.getItem('er-report-views') || '[]'); } catch { return []; } }

export function Reports() {
  useTitle('Reports');
  const { api, settings, subteams, activities, profile } = useStore((s) => ({ api: s.api, settings: s.settings, subteams: s.subteams, activities: s.activities, profile: s.profile }));
  const [f, setF] = useState(loadFilters);
  const [views, setViews] = useState(loadViews);
  const [sort, setSort] = useState({ key: 'value', dir: -1 });
  const [open, setOpen] = useState(null);
  const [page, setPage] = useState(0);
  useEffect(() => { try { localStorage.setItem('er-report-filters', JSON.stringify(f)); } catch { /* ignore */ } setPage(0); }, [f]);
  const set = (patch) => setF({ ...f, ...patch });

  const range = f.preset === 'custom'
    ? { from: parseIsoDate(f.from) || addDays(startOfDay(new Date()), -29), to: addDays(parseIsoDate(f.to) || startOfDay(new Date()), 1) }
    : presetRange(f.preset, settings);
  const rk = range.from.getTime() + ':' + range.to.getTime();
  const rev = useStore((s) => s.rev);
  const entriesRes = useAsync(() => api.listEntries(range.from, range.to), [api, rk, rev]);
  const eventsRes = useAsync(() => api.listEvents(addDays(range.from, -1), addDays(range.to, 1)), [api, rk]);
  const membersRes = useAsync(() => api.listMembers({ includeAll: true }), [api]);

  const memberById = useMemo(() => new Map((membersRes.data || []).map((m) => [m.uid, m])), [membersRes.data]);
  const eventById = useMemo(() => new Map((eventsRes.data || []).map((e) => [e.id, e])), [eventsRes.data]);

  const filtered = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    return (entriesRes.data || []).filter((e) => {
      if (f.members.length && !f.members.includes(e.uid)) return false;
      if (f.subteams.length && !f.subteams.includes(e.subteamId || 'none')) return false;
      if (f.activities.length && !f.activities.includes(e.activityId || 'none')) return false;
      if (f.events.length && !f.events.includes(e.eventId || 'none')) return false;
      if (f.statuses.length && !f.statuses.includes(e.status)) return false;
      if (f.sources.length && !f.sources.includes(e.source)) return false;
      if (f.geo.length && !f.geo.includes(e.geo || 'none')) return false;
      if (q && ![e.name, e.note, e.outNote, e.fix?.reason, activityById(e.activityId)?.name].some((t) => String(t || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [entriesRes.data, f]);

  const groupOf = (e) => {
    switch (f.groupBy) {
      case 'subteam': return [e.subteamId || 'none', subteamById(e.subteamId)?.name || 'No subteam', subteamById(e.subteamId)?.color || 'other'];
      case 'activity': return [e.activityId || 'none', activityById(e.activityId)?.name || 'No activity'];
      case 'event': { const ev = eventById.get(e.eventId); return [e.eventId || 'none', ev ? `${ev.title}, ${fmtShortDate(ev.start)}` : e.eventId ? 'Deleted event' : 'Not tied to an event']; }
      case 'week': return [weekKey(e.start), `Week of ${fmtShortDate(startOfWeek(e.start))}`];
      case 'day': return [isoDate(e.start), fmtDate(e.start)];
      default: return [e.uid, memberById.get(e.uid)?.name || e.name];
    }
  };

  const groups = useMemo(() => {
    const map = new Map();
    filtered.forEach((e) => {
      const [key, label, color] = groupOf(e);
      if (!map.has(key)) map.set(key, { key, label, color, ms: 0, sessions: 0, uids: new Set(), entries: [] });
      const g = map.get(key);
      g.ms += entryMs(e); g.sessions++; g.uids.add(e.uid); g.entries.push(e);
    });
    const total = [...map.values()].reduce((s, g) => s + g.ms, 0);
    const list = [...map.values()].map((g) => ({ ...g, value: hours(g.ms), members: g.uids.size, avg: g.sessions ? hours(g.ms) / g.sessions : 0, share: total ? g.ms / total : 0 }));
    const timeSort = f.groupBy === 'week' || f.groupBy === 'day';
    const k = sort.key;
    list.sort((a, b) => {
      if (timeSort && k === 'label') return sort.dir * a.key.localeCompare(b.key);
      const av = k === 'label' ? a.label : a[k], bv = k === 'label' ? b.label : b[k];
      return typeof av === 'string' ? sort.dir * av.localeCompare(bv) : sort.dir * (av - bv);
    });
    return { list, total };
  }, [filtered, f.groupBy, sort, memberById, eventById]);

  const kpis = useMemo(() => {
    const ms = filtered.reduce((s, e) => s + entryMs(e), 0);
    return { hours: hours(ms), sessions: filtered.length, members: new Set(filtered.map((e) => e.uid)).size, avg: filtered.length ? hours(ms) / filtered.length : 0 };
  }, [filtered]);

  const timeline = useMemo(() => {
    const tl = buildTimeline(filtered, range);
    fillTimeline(tl, filtered, (e) => e.subteamId && subteamById(e.subteamId) ? e.subteamId : 'none');
    const used = new Set(filtered.map((e) => (e.subteamId && subteamById(e.subteamId) ? e.subteamId : 'none')));
    const series = [...subteams.filter((s) => used.has(s.id)).map((s) => ({ key: s.id, label: s.name, color: s.color })), ...(used.has('none') ? [{ key: 'none', label: 'No subteam', color: 'other' }] : [])];
    return { ...tl, series };
  }, [filtered, rk, subteams]);

  // ── Exports ──
  const label = `${isoDate(range.from)}_to_${isoDate(addDays(range.to, -1))}`;
  const groupName = GROUPS.find(([k]) => k === f.groupBy)[1];
  const summaryRows = () => [[groupName, 'Hours', 'Sessions', 'Members', 'Average session (h)', 'Share of hours'],
    ...groups.list.map((g) => [g.label, fmtHours(g.value, 2), g.sessions, g.members, fmtHours(g.avg, 2), Math.round(g.share * 1000) / 10 + '%'])];
  const detailRows = () => [['Date', 'Member', 'Email', 'Subteam', 'Activity', 'Event', 'Start', 'End', 'Hours', 'Status', 'Source', 'Location', 'Note', 'Got done', 'Fix note', 'Lead note'],
    ...filtered.map((e) => {
      const m = memberById.get(e.uid);
      return [isoDate(e.start), m?.name || e.name, m?.email || '', subteamById(e.subteamId)?.name || '', activityById(e.activityId)?.name || '', eventById.get(e.eventId)?.title || '',
        fmtTime(e.start), e.end ? fmtTime(e.end) : '', fmtHours(hours(entryMs(e)), 2), e.status, e.source, e.geo || '', e.note || '', e.outNote || '', e.fix?.reason || '', e.reviewNote || ''];
    })];
  const toSheets = async () => {
    try {
      const file = await exportToSheets(`ER sessions, ${fmtDate(range.from)} to ${fmtDate(addDays(range.to, -1))}`, toCsv(detailRows()));
      toast('Saved to your Google Drive.', { action: file.webViewLink ? { label: 'Open', run: () => window.open(file.webViewLink, '_blank', 'noopener') } : undefined, timeout: 9000 });
    } catch (e) { toastError(e, 'Google Sheets export didn’t work.'); }
  };
  const saveView = () => openModal((close) => html`<${SaveViewDialog} close=${close} onSave=${(name) => {
    const next = [...views.filter((v) => v.name !== name), { name, f }];
    setViews(next);
    try { localStorage.setItem('er-report-views', JSON.stringify(next)); } catch { /* ignore */ }
    toast('View saved on this device.');
  }} />`);

  const memberOpts = (membersRes.data || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ value: m.uid, label: m.name + (m.status !== 'active' ? ` (${m.status})` : '') }));
  const subOpts = [...subteams.map((s) => ({ value: s.id, label: s.name, color: seriesColor(s.color) })), { value: 'none', label: 'No subteam' }];
  const actOpts = [...activities.map((a) => ({ value: a.id, label: a.name })), { value: 'none', label: 'No activity' }];
  const evOpts = [...(eventsRes.data || []).map((e) => ({ value: e.id, label: `${e.title}, ${fmtShortDate(e.start)}` })), { value: 'none', label: 'Not tied to an event' }];
  const activeFilters = ['members', 'subteams', 'activities', 'events', 'sources', 'geo'].filter((k) => f[k].length).length + (f.q ? 1 : 0) + (f.statuses.join() !== 'complete' ? 1 : 0);
  const loading = entriesRes.loading && !entriesRes.data;
  const timeGrouped = f.groupBy === 'week' || f.groupBy === 'day';
  const PAGE = 50;
  const detail = filtered.slice().sort((a, b) => new Date(b.start) - new Date(a.start));

  return html`<div class="content wide">
    <div class="page-head">
      <div><h1>Reports</h1><p>Hours by any combination of dates, people, subteams, activities and events.</p></div>
      <div class="actions">
        ${views.length > 0 && html`<${Menu} btnClass="btn" icon="filter" label="Saved views" text="Saved views" items=${views.map((v) => ({ label: v.name, onClick: () => setF({ ...DEFAULTS, ...v.f }) }))} />`}
        <button class="btn" onClick=${saveView}>Save view</button>
        <${Menu} btnClass="btn btn-primary" icon="download" label="Export" text="Export" items=${[
          { label: 'Summary as CSV', icon: 'download', onClick: () => downloadCsv(`er-hours-by-${f.groupBy}-${label}.csv`, summaryRows()) },
          { label: 'Every session as CSV', icon: 'download', onClick: () => downloadCsv(`er-sessions-${label}.csv`, detailRows()) },
          driveConfigured() ? { label: 'Every session to Google Sheets', icon: 'sheet', onClick: toSheets } : { label: 'Google Sheets export needs setup (SETUP.md, step 5)', icon: 'sheet', onClick: () => toast('Ask an admin to finish Google Drive setup to export to Sheets.', { kind: 'bad' }) },
        ]} />
      </div>
    </div>

    <section class="panel" aria-label="Filters">
      <div class="filters">
        <${Field} label="Dates"><select class="select" value=${f.preset} onChange=${(e) => set({ preset: e.target.value, from: f.from || isoDate(range.from), to: f.to || isoDate(addDays(range.to, -1)) })}>
          ${RANGE_PRESETS.map(([k, l]) => html`<option value=${k} key=${k}>${k === 'term' ? `${settings.termName || 'This term'}` : l}</option>`)}</select></${Field}>
        ${f.preset === 'custom' ? html`
          <${Field} label="From"><input class="input" type="date" value=${f.from} onInput=${(e) => set({ from: e.target.value })} /></${Field}>
          <${Field} label="To"><input class="input" type="date" value=${f.to} onInput=${(e) => set({ to: e.target.value })} /></${Field}>`
        : html`<div class="field" style="grid-column:span 2"><span>Range</span><div class="input" style="display:flex;align-items:center;background:var(--panel-2)">${fmtDate(range.from)} – ${fmtDate(addDays(range.to, -1))}</div></div>`}
        <${Field} label="Group by"><select class="select" value=${f.groupBy} onChange=${(e) => { set({ groupBy: e.target.value }); setSort({ key: e.target.value === 'week' || e.target.value === 'day' ? 'label' : 'value', dir: e.target.value === 'week' || e.target.value === 'day' ? 1 : -1 }); setOpen(null); }}>
          ${GROUPS.map(([k, l]) => html`<option value=${k} key=${k}>${l}</option>`)}</select></${Field}>
        <div class="field"><span>Members</span><${MultiSelect} options=${memberOpts} value=${f.members} onChange=${(v) => set({ members: v })} allLabel="Everyone" searchable /></div>
        <div class="field"><span>Subteams</span><${MultiSelect} options=${subOpts} value=${f.subteams} onChange=${(v) => set({ subteams: v })} allLabel="All subteams" /></div>
        <div class="field"><span>Activities</span><${MultiSelect} options=${actOpts} value=${f.activities} onChange=${(v) => set({ activities: v })} allLabel="All activities" /></div>
        <div class="field"><span>Events</span><${MultiSelect} options=${evOpts} value=${f.events} onChange=${(v) => set({ events: v })} allLabel="Any or none" searchable /></div>
        <div class="field"><span>Status</span><${MultiSelect} options=${STATUSES} value=${f.statuses} onChange=${(v) => set({ statuses: v })} allLabel="Any status" /></div>
        <div class="field"><span>Added by</span><${MultiSelect} options=${SOURCES} value=${f.sources} onChange=${(v) => set({ sources: v })} allLabel="Anyone" /></div>
        <div class="field"><span>Location check</span><${MultiSelect} options=${GEO} value=${f.geo} onChange=${(v) => set({ geo: v })} allLabel="Any" /></div>
        <${Field} label="Search notes and names"><input class="input" type="search" value=${f.q} placeholder="outreach, gripper…" onInput=${(e) => set({ q: e.target.value })} /></${Field}>
        <div class="field" style="justify-content:flex-end"><span class="sr-only">Reset</span>
          <button class="btn" onClick=${() => setF({ ...DEFAULTS, groupBy: f.groupBy })} disabled=${!activeFilters && f.preset === 'term'}>Reset filters${activeFilters ? ` (${activeFilters})` : ''}</button></div>
      </div>
    </section>

    ${entriesRes.error ? html`<div style="margin-top:16px"><${Notice} kind="bad">Couldn’t load sessions. ${entriesRes.error.code === 'permission-denied' ? 'Reports are for leads and admins.' : 'Check your connection and reload.'}</${Notice}></div>`
    : loading ? html`<${Loading} label="Loading sessions…" />` : html`
    <div style=${entriesRes.loading ? 'opacity:.55;transition:opacity .2s' : ''}>
      <section class="panel" style="margin-top:16px">
        <div class="readouts">
          <div class="readout"><div class="v">${fmtHours(kpis.hours)}<small>h</small></div><div class="k">Total hours</div></div>
          <div class="readout"><div class="v">${kpis.sessions.toLocaleString()}</div><div class="k">Sessions</div></div>
          <div class="readout"><div class="v">${kpis.members}</div><div class="k">Members</div></div>
          <div class="readout"><div class="v">${fmtHours(kpis.avg)}<small>h</small></div><div class="k">Average session</div></div>
        </div>
      </section>

      ${!filtered.length ? html`<div class="panel" style="margin-top:16px"><${Empty} title="No sessions match">Widen the dates or clear a filter.</${Empty}></div>` : html`
      <div class=${timeGrouped ? '' : 'grid-chart'} style="margin-top:16px">
        <section class="panel"><div class="panel-head"><h2>Hours per ${timeline.unit}${timeline.series.length > 1 ? ', by subteam' : ''}</h2></div>
          <div class="panel-body"><${ColumnChart} points=${timeline.points} series=${timeline.series} title=${'Hours per ' + timeline.unit} /></div></section>
        ${!timeGrouped && html`<section class="panel"><div class="panel-head"><h2>Top ${groupName.toLowerCase()}s by hours</h2><span class="small muted">${groups.list.length > 12 ? `12 of ${groups.list.length}` : ''}</span></div>
          <div class="panel-body"><${BarList} rows=${groups.list.slice().sort((a, b) => b.value - a.value).slice(0, 12).map((g) => ({ key: g.key, label: g.label, value: g.value, color: f.groupBy === 'subteam' ? g.color : undefined, detail: plural(g.sessions, 'session') }))}
            color="navy" onRowClick=${(r) => setOpen(open === r.key ? null : r.key)} /></div></section>`}
      </div>

      <h2 class="section-title">By ${groupName.toLowerCase()}</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr>${[['label', groupName], ['value', 'Hours', 1], ['sessions', 'Sessions', 1], ['members', 'Members', 1], ['avg', 'Avg session', 1], ['share', 'Share', 1]].map(([k, l, num]) => html`<th key=${k} class=${num ? 'num' : ''} aria-sort=${sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
          <button onClick=${() => setSort({ key: k, dir: sort.key === k ? -sort.dir : (k === 'label' ? 1 : -1) })}>${l}${sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button></th>`)}</tr></thead>
        <tbody>${groups.list.map((g) => html`
          <tr key=${g.key}><td><button class="link-btn" style="text-decoration:none;color:var(--text);font-weight:600" aria-expanded=${String(open === g.key)} onClick=${() => setOpen(open === g.key ? null : g.key)}>${open === g.key ? '▾ ' : '▸ '}${g.label}</button>
              ${f.groupBy === 'member' && html` <a class="small" href=${href('/members/' + g.key)} style="margin-left:6px">Profile</a>`}</td>
            <td class="num">${fmtHours(g.value)}</td><td class="num">${g.sessions}</td><td class="num">${g.members}</td><td class="num">${fmtHours(g.avg)}</td><td class="num">${Math.round(g.share * 100)}%</td></tr>
          ${open === g.key && g.entries.slice().sort((a, b) => new Date(b.start) - new Date(a.start)).map((e) => html`<tr class="sub-row" key=${e.id}>
            <td colspan="6"><div class="row wrap" style="gap:10px"><span class="nowrap">${fmtDate(e.start)}</span><span class="nowrap muted">${fmtRange(e.start, e.end)}</span>
              <span class="num">${fmtDuration(entryMs(e))}</span>${f.groupBy !== 'member' ? html`<span>${e.name}</span>` : ''}<span class="muted">${activityById(e.activityId)?.name || ''}</span>
              ${e.status !== 'complete' && html`<${StatusBadge} status=${e.status} />`}<span class="spacer"></span>
              <button class="btn btn-sm btn-quiet" onClick=${() => openEntryEditor(e)}><${Icon} name="edit" />Edit</button></div></td></tr>`)}`)}
        </tbody>
        <tfoot><tr><td>Total</td><td class="num">${fmtHours(kpis.hours)}</td><td class="num">${kpis.sessions}</td><td class="num">${kpis.members}</td><td class="num">${fmtHours(kpis.avg)}</td><td class="num">100%</td></tr></tfoot>
      </table></div>

      <h2 class="section-title">Every session <span class="muted small" style="font-weight:500">${plural(detail.length, 'session')}</span></h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Date</th><th>Member</th><th>Time</th><th class="num">Hours</th><th>Activity</th><th>Subteam</th><th>Status</th><th>Notes</th><th><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${detail.slice(page * PAGE, page * PAGE + PAGE).map((e) => html`<tr key=${e.id}>
          <td class="nowrap">${fmtDate(e.start)}</td>
          <td class="nowrap"><a href=${href('/members/' + e.uid)} style="color:var(--text)">${memberById.get(e.uid)?.name || e.name}</a></td>
          <td class="nowrap">${fmtRange(e.start, e.end)}</td>
          <td class="num">${fmtHours(hours(entryMs(e)), 2)}</td>
          <td>${activityById(e.activityId)?.name || html`<span class="muted">None</span>`}</td>
          <td class="nowrap">${subteamById(e.subteamId) ? html`<span class="row" style="gap:6px"><i style=${{ width: '8px', height: '8px', borderRadius: '50%', background: seriesColor(subteamById(e.subteamId).color) }}></i>${subteamById(e.subteamId).name}</span>` : html`<span class="muted">None</span>`}</td>
          <td><${StatusBadge} status=${e.status} />${e.source === 'lead' ? html` <span class="badge badge-plain">Lead</span>` : ''}${e.geo === 'off-site' ? html` <span class="badge badge-plain">Away</span>` : ''}</td>
          <td class="small" style="max-width:280px">${[e.note, e.outNote, e.fix?.reason].filter(Boolean).join(' / ')}</td>
          <td><button class="btn btn-sm btn-quiet btn-icon" aria-label=${'Edit ' + e.name + ' session'} onClick=${() => openEntryEditor(e)}><${Icon} name="edit" size=${16} /></button></td>
        </tr>`)}</tbody>
      </table></div>
      ${detail.length > PAGE && html`<div class="row" style="justify-content:center;margin-top:12px;gap:8px">
        <button class="btn btn-sm" disabled=${page === 0} onClick=${() => setPage(page - 1)}><${Icon} name="chevronLeft" />Newer</button>
        <span class="small muted">Page ${page + 1} of ${Math.ceil(detail.length / PAGE)}</span>
        <button class="btn btn-sm" disabled=${(page + 1) * PAGE >= detail.length} onClick=${() => setPage(page + 1)}>Older<${Icon} name="chevronRight" /></button></div>`}
      `}
    </div>`}
  </div>`;
}

function SaveViewDialog({ close, onSave }) {
  const [name, setName] = useState('');
  const save = () => { if (name.trim()) { onSave(name.trim()); close(); } };
  return html`<${Modal} title="Save this view" onClose=${close}
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${!name.trim()}>Save view</button>`}>
    <p class="small muted" style="margin-top:0">Saves the current filters and grouping on this device so you can run the same report again.</p>
    <${Field} label="Name"><input class="input" value=${name} maxlength="60" placeholder="Travel eligibility check" onInput=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && save()} /></${Field}>
  </${Modal}>`;
}
