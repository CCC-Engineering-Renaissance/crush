// Calendar: meetings, build days, pool tests, competitions and outreach.
import { html, useState, useEffect, useMemo, Icon, Modal, openModal, Field, Seg, Chip, Loading, Empty, Notice, useAsync, toast, toastError, confirmDialog } from '../lib/ui.js';
import { useStore, isLead, isAdmin, subteamById, subteamLabel, bump } from '../lib/store.js';
import {
  startOfDay, addDays, startOfWeek, startOfMonth, addMonths, isoDate, parseIsoDate, sameDay, fmtDate, fmtTime, fmtMonth, combine, timeInput,
} from '../lib/time.js';
import { Markdown } from '../lib/text.js';
import { downloadText } from '../lib/csv.js';
import { seriesColor } from './charts.js';
import { DateBlock } from './home.js';
import { useTitle, SubteamPicker } from './common.js';

export const EVENT_TYPES = {
  meeting: ['Meeting', 'navy'], build: ['Build day', 'lime'], pool: ['Pool test', 'sky'], competition: ['Competition', 'magenta'],
  outreach: ['Outreach', 'orange'], social: ['Social', 'gold'], other: ['Other', 'other'],
};
const typeColor = (t) => seriesColor((EVENT_TYPES[t] || EVENT_TYPES.other)[1]);

export function CalendarView() {
  useTitle('Calendar');
  const { api, profile, feedUrl } = useStore((s) => ({ api: s.api, profile: s.profile, feedUrl: s.settings.calendarFeedUrl }));
  const rev = useStore((s) => s.rev);
  const lead = isLead(profile);
  // Members see Subscribe once an admin has set up the feed; admins always, so they find the setup.
  const canSubscribe = api.mode === 'demo' || !!feedUrl || isAdmin(profile);
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
      <div><h1>Calendar</h1><p>Meetings, build days, pool tests and outreach. Subscribe to keep them in your own calendar app.</p></div>
      <div class="actions">
        ${canSubscribe && html`<button class="btn" onClick=${openSubscribe}><${Icon} name="link" />Subscribe</button>`}
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

// ── Subscribing: each member's own link for their calendar app ──
// The link is the calendar-feed script's address plus a random id. The id is saved with the
// subteams it shows, so changing them later keeps the same link.
const SAMPLE_FEED = 'https://script.google.com/macros/s/sample-calendar-feed/exec';
const newFeedId = () => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => abc[b % 62]).join('');
};
const sameSet = (a = [], b = []) => a.length === b.length && a.every((x) => b.includes(x));

export function openSubscribe() {
  openModal((close) => html`<${Subscribe} close=${close} />`);
}

function Subscribe({ close }) {
  const { api, profile, feedUrl } = useStore((s) => ({ api: s.api, profile: s.profile, feedUrl: s.settings.calendarFeedUrl }));
  const demo = api.mode === 'demo';
  const base = demo ? SAMPLE_FEED : String(feedUrl || '').trim();
  const res = useAsync(() => api.getMyCalendarFeed(profile.uid), [api, profile.uid]);
  const [saved, setSaved] = useState(undefined); // undefined: loading; null: no link yet
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (res.loading || saved !== undefined) return;
    const s0 = res.data || null;
    setSaved(s0);
    setF(s0 ? { subteams: s0.subteams || [], everything: !!s0.everything } : { subteams: profile.subteams || [], everything: false });
  }, [res.loading]);

  const footer = html`<button class="btn" onClick=${close}>Done</button>`;
  if (!base) {
    return html`<${Modal} title="Subscribe to the calendar" onClose=${close} footer=${footer}>
      <${Notice}>Calendar subscriptions aren’t turned on yet.${isAdmin(profile) ? html` Turn them on in <a href="#/admin/settings" onClick=${close}>Admin → Settings</a>. SETUP.md step 9 walks through it.` : ' An admin can turn them on.'}</${Notice}>
    </${Modal}>`;
  }
  if (res.error) return html`<${Modal} title="Subscribe to the calendar" onClose=${close} footer=${footer}><${Notice} kind="bad">Couldn’t load your calendar link. Try again.</${Notice}></${Modal}>`;
  if (saved === undefined || !f) return html`<${Modal} title="Subscribe to the calendar" onClose=${close} footer=${footer}><${Loading} /></${Modal}>`;

  const url = saved ? `${base}?k=${saved.id}` : '';
  const webcal = url.replace(/^https:/, 'webcal:');
  const dirty = saved && (f.everything !== !!saved.everything || !sameSet(f.subteams, saved.subteams));
  const save = async (fresh) => {
    setBusy(true);
    try {
      const id = fresh ? newFeedId() : saved.id;
      await api.saveMyCalendarFeed(profile.uid, { id, subteams: f.subteams, everything: f.everything }, fresh);
      setSaved({ id, subteams: f.subteams, everything: f.everything });
      toast(fresh ? 'Your calendar link is ready.' : 'Saved. Your calendar app picks this up the next time it checks.');
    } catch (e) { toastError(e); }
    setBusy(false);
  };
  const turnOff = async () => {
    const ok = await confirmDialog({ title: 'Turn off your calendar link?', body: 'Calendars subscribed with it will empty out. You can get a new link any time.', confirmLabel: 'Turn off', danger: true });
    if (!ok) return;
    try { await api.deleteMyCalendarFeed(saved.id); setSaved(null); toast('Your calendar link is turned off.'); } catch (e) { toastError(e); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2200); }
    catch { document.getElementById('feed-url')?.select(); }
  };
  return html`<${Modal} title="Subscribe to the calendar" onClose=${close} footer=${footer}>
    <div class="stack" style="gap:20px">
      <p style="margin:0;color:var(--text-2)">Your own link for Google Calendar, Apple Calendar or Outlook. New and changed events show up there on their own.</p>
      ${demo && html`<${Notice}>This is the demo, so the link is a sample that calendar apps can’t open.</${Notice}>`}
      <section aria-labelledby="feed-what">
        <h3 class="mini-head" id="feed-what">What’s on it</h3>
        <${Seg} label="What’s on it" value=${f.everything ? 'all' : 'mine'} onChange=${(v) => setF({ ...f, everything: v === 'all' })}
          options=${[['mine', 'Subteams I pick'], ['all', 'Everything']]} />
        ${f.everything
          ? html`<p class="small muted" style="margin:10px 0 0">Every club event, for every subteam.</p>`
          : html`<p class="small muted" style="margin:10px 0 10px">Club-wide events are always on it. Add the subteams whose events you want too.</p>
            <${SubteamPicker} value=${f.subteams} onChange=${(v) => setF({ ...f, subteams: v })} />`}
      </section>
      <section aria-labelledby="feed-link">
        <h3 class="mini-head" id="feed-link">Your link</h3>
        ${!saved
          ? html`<button class="btn btn-primary" onClick=${() => save(true)} disabled=${busy}>${busy ? 'Making your link…' : 'Get my link'}</button>`
          : html`<div class="stack" style="gap:12px">
            ${dirty && html`<div class="row wrap" style="gap:10px"><button class="btn btn-primary" onClick=${() => save(false)} disabled=${busy}>${busy ? 'Saving…' : 'Save changes'}</button>
              <span class="small muted">Your link stays the same.</span></div>`}
            <div class="row" style="gap:8px">
              <input id="feed-url" class="input" readonly value=${url} aria-label="Your calendar link" onFocus=${(e) => e.target.select()} style="flex:1;min-width:0" />
              <button class="btn" onClick=${copy}><${Icon} name=${copied ? 'check' : 'copy'} />${copied ? 'Copied' : 'Copy'}</button>
            </div>
            ${!demo && html`<div class="row wrap" style="gap:8px">
              <a class="btn" href=${'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal)} target="_blank" rel="noopener">Add to Google Calendar</a>
              <a class="btn" href=${webcal}>Add to Apple Calendar</a>
            </div>`}
            <p class="small muted" style="margin:0">Outlook: <b>Add calendar → Subscribe from web</b>, then paste the link. Calendar apps check for changes on their own schedule: Google Calendar can take up to a day, Apple Calendar and Outlook are usually quicker.</p>
            <div><button class="btn btn-quiet btn-sm" onClick=${turnOff}>Turn off this link</button></div>
          </div>`}
      </section>
    </div>
  </${Modal}>`;
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
        ${(e.subteams || []).map((id) => subteamById(id) && html`<${Chip} key=${id} color=${seriesColor(subteamById(id).color)}>${subteamLabel(id)}</${Chip}>`)}</div>
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
      <div class="field full"><span>For subteams (optional)</span><${SubteamPicker} value=${f.subteams} onChange=${(v) => setF({ ...f, subteams: v })} /></div>
      ${!e && html`<${Field} label="Repeat weekly until (optional)" hint="Creates one event per week, same day and time."><input class="input" type="date" value=${f.repeatUntil} min=${f.date} onInput=${set('repeatUntil')} /></${Field}>`}
    </div>
    ${err && html`<p class="form-error" role="alert">${err}</p>`}
  </${Modal}>`;
}
