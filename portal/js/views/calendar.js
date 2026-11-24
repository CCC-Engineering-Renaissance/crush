// Calendar: meetings, build days, pool tests, competitions and outreach.
import { html, useState, useMemo, Icon, Modal, openModal, Field, Seg, Chip, Loading, Empty, useAsync, toast, toastError, confirmDialog } from '../lib/ui.js';
import { useStore, isLead, subteamById, bump } from '../lib/store.js';
import {
  startOfDay, addDays, startOfWeek, startOfMonth, addMonths, isoDate, parseIsoDate, sameDay, fmtDate, fmtTime, fmtMonth, combine, timeInput,
} from '../lib/time.js';
import { Markdown } from '../lib/text.js';
import { downloadText } from '../lib/csv.js';
import { seriesColor } from './charts.js';
import { DateBlock } from './home.js';
import { useTitle } from './common.js';

export const EVENT_TYPES = {
  meeting: ['Meeting', 'navy'], build: ['Build day', 'lime'], pool: ['Pool test', 'sky'], competition: ['Competition', 'magenta'],
  outreach: ['Outreach', 'orange'], social: ['Social', 'gold'], other: ['Other', 'other'],
};
const typeColor = (t) => seriesColor((EVENT_TYPES[t] || EVENT_TYPES.other)[1]);

export function CalendarView() {
  useTitle('Calendar');
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const rev = useStore((s) => s.rev);
  const lead = isLead(profile);
  const [view, setView] = useState(window.innerWidth < 700 ? 'agenda' : 'month');
  const [cursor, setCursor] = useState(startOfMonth(new Date()));
  const gridStart = startOfWeek(cursor);
  const gridEnd = addDays(gridStart, 42);
  const from = view === 'month' ? gridStart : startOfDay(new Date());
  const to = view === 'month' ? gridEnd : addDays(startOfDay(new Date()), 90);
  const res = useAsync(() => api.listEvents(from, to), [api, view, from.getTime(), rev]);
  const events = res.data || [];

  return html`<div class="content wide">
    <div class="page-head">
      <div><h1>Calendar</h1><p>Meetings, build days, pool tests and outreach. Add any event to your own Google Calendar.</p></div>
      <div class="actions">
        <${Seg} label="View" value=${view} onChange=${setView} options=${[['month', 'Month'], ['agenda', 'Upcoming']]} />
        ${lead && html`<button class="btn btn-primary" onClick=${() => openEventEditor(null)}><${Icon} name="plus" />New event</button>`}
      </div>
    </div>
    ${view === 'month' ? html`
      <div class="row" style="margin-bottom:12px">
        <button class="btn btn-sm btn-icon" aria-label="Previous month" onClick=${() => setCursor(addMonths(cursor, -1))}><${Icon} name="chevronLeft" /></button>
        <button class="btn btn-sm btn-icon" aria-label="Next month" onClick=${() => setCursor(addMonths(cursor, 1))}><${Icon} name="chevronRight" /></button>
        <h2 style="margin:0 6px;font-size:20px;font-family:var(--font-num);font-weight:600">${fmtMonth(cursor)}</h2>
        <button class="btn btn-sm" onClick=${() => setCursor(startOfMonth(new Date()))}>Today</button>
        <span class="spacer"></span>
        <div class="legend" aria-label="Event types">${Object.entries(EVENT_TYPES).map(([k, [l]]) => html`<span key=${k}><i style=${{ background: typeColor(k) }}></i>${l}</span>`)}</div>
      </div>
      <${MonthGrid} start=${gridStart} month=${cursor.getMonth()} events=${events} />`
    : res.loading && !res.data ? html`<${Loading} />` : html`<${Agenda} events=${events} />`}
  </div>`;
}

function MonthGrid({ start, month, events }) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const byDay = useMemo(() => {
    const m = new Map();
    events.forEach((e) => { const k = isoDate(e.start); if (!m.has(k)) m.set(k, []); m.get(k).push(e); });
    return m;
  }, [events]);
  const today = new Date();
  // Each day carries its full date, so the weekday row is for sighted readers only.
  return html`<div class="cal" role="group" aria-label="Month view">
    ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<div class="dow" aria-hidden="true" key=${d}>${d}</div>`)}
    ${days.map((d) => {
      const list = byDay.get(isoDate(d)) || [];
      return html`<div key=${isoDate(d)} class=${'day' + (d.getMonth() !== month ? ' other' : '') + (sameDay(d, today) ? ' today' : '')}>
        <span class="n" aria-hidden="true">${d.getDate()}</span><span class="sr-only">${fmtDate(d)}</span>
        ${list.slice(0, 3).map((e) => html`<button class="ev" key=${e.id} style=${{ '--c': typeColor(e.type) }} onClick=${() => openEventDetail(e)} title=${`${fmtTime(e.start)} ${e.title}`}>${fmtTime(e.start).replace(':00', '')} ${e.title}</button>`)}
        ${list.length > 3 && html`<button class="ev" style="--c:var(--line-2)" onClick=${() => openDayList(d, list)}>${list.length - 3} more</button>`}
      </div>`;
    })}
  </div>`;
}

function Agenda({ events }) {
  if (!events.length) return html`<div class="panel"><${Empty} title="Nothing coming up">Events for the next 90 days show up here.</${Empty}></div>`;
  return html`<div class="panel"><ul class="list list-flush">${events.map((e) => html`<li key=${e.id}>
    <${DateBlock} date=${e.start} />
    <span class="grow"><button class="link-btn" style="text-decoration:none;color:var(--text);font-size:15px;text-align:left" onClick=${() => openEventDetail(e)}>${e.title}</button>
      <div class="meta">${fmtDate(e.start)}, ${fmtTime(e.start)} – ${fmtTime(e.end)}${e.location ? ` in ${e.location}` : ''}</div></span>
    <span class="chip"><i style=${{ background: typeColor(e.type) }}></i>${(EVENT_TYPES[e.type] || EVENT_TYPES.other)[0]}</span>
  </li>`)}</ul></div>`;
}

function openDayList(day, list) {
  openModal((close) => html`<${Modal} title=${fmtDate(day)} onClose=${close}>
    <ul class="list">${list.map((e) => html`<li key=${e.id}><span class="grow"><button class="link-btn" style="text-decoration:none;color:var(--text)" onClick=${() => { close(); openEventDetail(e); }}>${e.title}</button>
      <div class="meta">${fmtTime(e.start)} – ${fmtTime(e.end)}</div></span></li>`)}</ul>
  </${Modal}>`);
}

// ── Event detail ──
const utc = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function gcalLink(e) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${utc(e.start)}/${utc(e.end)}`, details: e.description || '', location: e.location || '' });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}
function icsFor(e) {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Engineering Renaissance//Member Portal//EN', 'BEGIN:VEVENT',
    `UID:${e.id}@engineeringrenaissance.org`, `DTSTAMP:${utc(new Date())}`, `DTSTART:${utc(e.start)}`, `DTEND:${utc(e.end)}`,
    `SUMMARY:${esc(e.title)}`, `LOCATION:${esc(e.location)}`, `DESCRIPTION:${esc(e.description)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

export function openEventDetail(e) {
  openModal((close) => html`<${EventDetail} e=${e} close=${close} />`);
}
function EventDetail({ e, close }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const lead = isLead(profile);
  const remove = async () => {
    if (!(await confirmDialog({ title: 'Delete this event?', body: `“${e.title}” on ${fmtDate(e.start)} will be removed from the calendar. Sessions already linked to it keep their hours.`, confirmLabel: 'Delete event', danger: true }))) return;
    try { await api.deleteEvent(e.id); api.log(profile, 'event.delete', `Deleted event “${e.title}” on ${fmtDate(e.start)}`, { type: 'event', id: e.id }); bump(); toast('Event deleted.'); close(); } catch (err) { toastError(err); }
  };
  return html`<${Modal} title=${e.title} onClose=${close}
    footer=${html`${lead && html`<button class="btn btn-danger left" onClick=${remove}><${Icon} name="trash" />Delete</button>
      <button class="btn" onClick=${() => { close(); openEventEditor(e); }}><${Icon} name="edit" />Edit</button>`}
      <button class="btn" onClick=${() => downloadText(`${e.title.replace(/[^\w]+/g, '-').toLowerCase()}.ics`, icsFor(e), 'text/calendar;charset=utf-8')}><${Icon} name="download" />.ics file</button>
      <a class="btn btn-primary" href=${gcalLink(e)} target="_blank" rel="noopener noreferrer"><${Icon} name="calendar" />Add to Google Calendar</a>`}>
    <div class="stack" style="gap:10px">
      <div class="row wrap" style="gap:8px"><span class="chip"><i style=${{ background: typeColor(e.type) }}></i>${(EVENT_TYPES[e.type] || EVENT_TYPES.other)[0]}</span>
        ${(e.subteams || []).map((id) => subteamById(id) && html`<${Chip} key=${id} color=${seriesColor(subteamById(id).color)}>${subteamById(id).name}</${Chip}>`)}</div>
      <div class="row"><${Icon} name="clock" size=${18} /><span>${fmtDate(e.start)}, ${fmtTime(e.start)} – ${fmtTime(e.end)}</span></div>
      ${e.location && html`<div class="row"><${Icon} name="mapPin" size=${18} /><span>${e.location}</span></div>`}
      ${e.description && html`<${Markdown} text=${e.description} />`}
    </div>
  </${Modal}>`;
}

// ── Event editor (leads) ──
export function openEventEditor(e) { openModal((close) => html`<${EventEditor} e=${e} close=${close} />`); }
function EventEditor({ e, close }) {
  const { api, profile, subteams } = useStore((s) => ({ api: s.api, profile: s.profile, subteams: s.subteams }));
  const s0 = e ? new Date(e.start) : (() => { const d = addDays(startOfDay(new Date()), 1); d.setHours(17, 0, 0, 0); return d; })();
  const e0 = e ? new Date(e.end) : new Date(s0.getTime() + 2 * 3600e3);
  const [f, setF] = useState({ title: e?.title || '', type: e?.type || 'meeting', date: isoDate(s0), start: timeInput(s0), end: timeInput(e0), location: e?.location || '', description: e?.description || '', subteams: e?.subteams || [], repeatUntil: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value });
  const save = async () => {
    const start = combine(f.date, f.start);
    let end = combine(f.date, f.end);
    if (!f.title.trim()) return setErr('Give the event a title.');
    if (!start || !end) return setErr('Pick a date and times.');
    if (end <= start) end = addDays(end, 1); // runs past midnight
    const base = { title: f.title.trim(), type: f.type, location: f.location.trim(), description: f.description.trim(), subteams: f.subteams };
    const list = [{ ...(e ? { id: e.id } : {}), ...base, start, end, seriesId: e?.seriesId || null }];
    if (!e && f.repeatUntil) {
      const until = addDays(parseIsoDate(f.repeatUntil), 1);
      const seriesId = 's' + Date.now().toString(36);
      list[0].seriesId = seriesId;
      for (let k = 1; k < 52; k++) {
        const s2 = addDays(start, 7 * k);
        if (s2 >= until) break;
        list.push({ ...base, start: s2, end: addDays(end, 7 * k), seriesId });
      }
    }
    setBusy(true); setErr('');
    try {
      await api.saveEvents(list, profile);
      api.log(profile, e ? 'event.edit' : 'event.add', `${e ? 'Edited' : 'Added'} “${base.title}” on ${fmtDate(start)}${list.length > 1 ? ` (${list.length} weekly events)` : ''}`, { type: 'event' });
      bump();
      toast(list.length > 1 ? `Added ${list.length} weekly events.` : e ? 'Event saved.' : 'Event added.');
      close();
    } catch (ex) { toastError(ex); setBusy(false); }
  };
  return html`<${Modal} title=${e ? 'Edit event' : 'New event'} onClose=${close} wide
    footer=${html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>${e ? 'Save event' : 'Add event'}</button>`}>
    <div class="form-grid">
      <${Field} label="Title" full><input class="input" value=${f.title} maxlength="140" onInput=${set('title')} placeholder="General meeting" /></${Field}>
      <${Field} label="Type"><select class="select" value=${f.type} onChange=${set('type')}>${Object.entries(EVENT_TYPES).map(([k, [l]]) => html`<option value=${k} key=${k}>${l}</option>`)}</select></${Field}>
      <${Field} label="Date"><input class="input" type="date" value=${f.date} onInput=${set('date')} /></${Field}>
      <${Field} label="Starts"><input class="input" type="time" value=${f.start} onInput=${set('start')} /></${Field}>
      <${Field} label="Ends"><input class="input" type="time" value=${f.end} onInput=${set('end')} /></${Field}>
      <${Field} label="Location" full><input class="input" value=${f.location} maxlength="140" onInput=${set('location')} placeholder="Room or place" /></${Field}>
      <${Field} label="Details (optional)" full hint="Supports **bold**, *italic*, links and - lists."><textarea class="textarea" value=${f.description} maxlength="4000" onInput=${set('description')}></textarea></${Field}>
      <div class="field full"><span>For subteams (optional)</span><div class="chips">${subteams.map((s) => html`<button type="button" key=${s.id} class="chip chip-toggle" aria-pressed=${String(f.subteams.includes(s.id))}
        onClick=${() => setF({ ...f, subteams: f.subteams.includes(s.id) ? f.subteams.filter((x) => x !== s.id) : [...f.subteams, s.id] })}>${s.name}</button>`)}</div></div>
      ${!e && html`<${Field} label="Repeat weekly until (optional)" hint="Creates one event per week, same day and time."><input class="input" type="date" value=${f.repeatUntil} min=${f.date} onInput=${set('repeatUntil')} /></${Field}>`}
    </div>
    ${err && html`<p class="form-error" role="alert">${err}</p>`}
  </${Modal}>`;
}
