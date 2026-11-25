// Home: the clock-in panel first, then hours, who's in the lab, news, events and tasks.
import { html, useState, useEffect, useMemo, Icon, Avatar, Chip, useNow, useAsync, toast, toastError, Notice, Loading } from '../lib/ui.js';
import { useStore, isLead, isAdmin, activityById, subteamById, getState, visibleSpaces, spaceLabel } from '../lib/store.js';
import { href } from '../lib/router.js';
import {
  clockParts, fmtTime, fmtDate, fmtDateTime, relTime, greeting, startOfDay, addDays, startOfWeek, termRange,
  entryMs, hours, fmtHours, toLocalInput, fromLocalInput, HOUR, fmtShortDate, fmtMonShort, isoDate,
} from '../lib/time.js';
import { Markdown, plural } from '../lib/text.js';
import { Contours, useTitle } from './common.js';

export function Home() {
  useTitle('Home');
  const { api, profile, settings } = useStore((s) => ({ api: s.api, profile: s.profile, settings: s.settings }));
  const lead = isLead(profile);
  const today = startOfDay(new Date());
  const events = useAsync(() => api.listEvents(addDays(today, -1), addDays(today, 45)), [api]);
  return html`<div class="content">
    <h1 class="sr-only">Home</h1>
    <${ClockPanel} events=${events.data || []} />
    <div class="grid-2" style="margin-top:16px">
      <${HoursPanel} />
      <${LabPanel} />
    </div>
    ${lead && html`<${ReviewPanel} />`}
    <div class="grid-2" style="margin-top:16px">
      <${NewsPanel} />
      <${UpcomingPanel} events=${events} />
    </div>
    <${TasksPanel} />
  </div>`;
}

// ───────── Clock panel ─────────
function lastActivity() { try { return localStorage.getItem('er-last-activity') || ''; } catch { return ''; } }

function distanceM(a, b) {
  const R = 6371e3, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function checkLocation(lc) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve('unknown');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const d = distanceM({ lat: pos.coords.latitude, lng: pos.coords.longitude }, { lat: lc.lat, lng: lc.lng });
        resolve(d <= (lc.radiusM || 250) + Math.min(pos.coords.accuracy || 0, 150) ? 'on-site' : 'off-site');
      },
      () => resolve('unknown'),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 },
    );
  });
}

export function ClockPanel({ events = [] }) {
  const { api, profile, settings, activities, presence } = useStore((s) => ({ api: s.api, profile: s.profile, settings: s.settings, activities: s.activities, presence: s.presence }));
  const mine = presence.find((p) => p.uid === profile.uid) || null;
  const now = useNow(1000, !!mine);
  const elapsed = mine ? now - new Date(mine.start).getTime() : 0;
  const stale = mine && elapsed > (settings.maxSessionHours || 10) * HOUR;

  const myActs = useMemo(() => {
    const live = activities.filter((a) => !a.archived);
    const mineFirst = live.filter((a) => !a.subteamId || profile.subteams?.includes(a.subteamId));
    return mineFirst.length ? mineFirst : live;
  }, [activities, profile.subteams]);
  const [activityId, setActivityId] = useState(() => lastActivity());
  const [note, setNote] = useState('');
  const [outNote, setOutNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const current = events.find((e) => {
    const s = new Date(e.start).getTime() - 30 * 60e3, en = new Date(e.end).getTime() + 30 * 60e3;
    return Date.now() >= s && Date.now() <= en;
  });
  const [linkEvent, setLinkEvent] = useState(true);
  const selectedAct = activities.find((a) => a.id === activityId) ? activityId : (myActs[0]?.id || '');

  const clockIn = async () => {
    setBusy(true);
    try {
      let geo = null;
      const lc = settings.locationCheck || {};
      if (lc.enabled && lc.lat != null && lc.lng != null) {
        geo = await checkLocation(lc);
        if (geo !== 'on-site' && lc.mode === 'block') {
          toast(geo === 'unknown' ? 'Turn on location for this site to clock in. The club checks that you’re at the lab.' : 'You need to be at the lab to clock in.', { kind: 'bad', timeout: 7000 });
          setBusy(false); return;
        }
      }
      const act = activityById(selectedAct);
      try { localStorage.setItem('er-last-activity', selectedAct); } catch { /* ignore */ }
      await api.clockIn({
        activityId: selectedAct || null,
        subteamId: act?.subteamId || profile.subteams?.[0] || null,
        eventId: current && linkEvent ? current.id : null,
        note: note.trim(), geo,
      }, profile);
      setNote('');
      toast(`Clocked in at ${fmtTime(new Date())}.`);
    } catch (e) {
      toastError(e, 'Clock-in didn’t go through. Try again.');
    }
    setBusy(false);
  };

  const clockOut = async () => {
    setBusy(true);
    try {
      const entry = { id: mine.entryId };
      await api.clockOut(entry, profile, { outNote: outNote.trim(), hasPresence: true });
      setOutNote('');
      toast(`Clocked out. That session was ${clockParts(Date.now() - new Date(mine.start)).h} h ${clockParts(Date.now() - new Date(mine.start)).m} min.`);
    } catch (e) {
      toastError(e, 'Clock-out didn’t go through. Try again.');
    }
    setBusy(false);
  };

  if (stale) return html`<${StaleSession} mine=${mine} />`;

  const t = clockParts(elapsed);
  const digits = (s) => s.split('').map((ch, i) => html`<span key=${i} class=${ch === ':' ? 'sep' : ''}>${ch}</span>`);
  const act = mine ? activityById(mine.activityId) : null;
  const visibleActs = showAll ? activities.filter((a) => !a.archived) : myActs.slice(0, 7);

  return html`<section class="clock" aria-label="Time clock">
    <${Contours} cx=${880} cy=${80} rings=${10} step=${70} />
    <p class="greet">${greeting()}, ${profile.name.split(' ')[0]}</p>
    <div class="state">${mine
      ? html`<span class="dot live"></span>Clocked in since ${fmtTime(mine.start)}${act ? ` on ${act.name}` : ''}`
      : html`<span class="dot"></span>Not clocked in`}</div>
    <div class=${'timer' + (mine ? '' : ' idle')} role="timer" aria-live="off">${digits(mine ? t.text : '0:00:00')}</div>

    ${mine ? html`
      <div class="controls">
        <label class="field" style="flex:1;min-width:220px"><span>What did you get done? (optional)</span>
          <input class="input" value=${outNote} maxlength="500" placeholder="Tapped the frame plates, tested the gripper…" onInput=${(e) => setOutNote(e.target.value)} /></label>
        <button class="clock-btn out" onClick=${clockOut} disabled=${busy}><${Icon} name="stop" />${busy ? 'Clocking out…' : 'Clock out'}</button>
      </div>`
    : html`
      <div style="margin-top:14px">
        <div class="field"><span>What are you working on?</span></div>
        <div class="chips" style="margin-top:8px" role="radiogroup" aria-label="Activity">
          ${visibleActs.map((a) => html`<button key=${a.id} type="button" class="chip chip-toggle" role="radio" aria-checked=${String(a.id === selectedAct)} onClick=${() => setActivityId(a.id)}>${a.name}</button>`)}
          ${!showAll && activities.length > visibleActs.length && html`<button type="button" class="chip chip-toggle" onClick=${() => setShowAll(true)}>More…</button>`}
          ${!activities.length && html`<span class="small" style="color:rgba(255,255,255,.7)">No activities yet. ${isLead(profile) ? 'Add some in Admin.' : 'A lead can add them.'}</span>`}
        </div>
      </div>
      ${current && html`<label class="check" style="margin-top:14px;color:rgba(255,255,255,.85)">
        <input type="checkbox" checked=${linkEvent} onChange=${(e) => setLinkEvent(e.target.checked)} />
        <span>Count this toward <b>${current.title}</b> (${fmtTime(current.start)} – ${fmtTime(current.end)})</span></label>`}
      <div class="controls">
        <label class="field" style="flex:1;min-width:220px"><span>Note (optional)</span>
          <input class="input" value=${note} maxlength="500" placeholder="Anything leads should know" onInput=${(e) => setNote(e.target.value)} /></label>
        <button class="clock-btn in" onClick=${clockIn} disabled=${busy}><${Icon} name="play" />${busy ? 'Clocking in…' : 'Clock in'}</button>
      </div>
      ${settings.locationCheck?.enabled && html`<p class="small" style="margin:12px 0 0;color:rgba(255,255,255,.7)"><${Icon} name="mapPin" size=${14} /> Clocking in checks that you’re at the lab. Your location isn’t saved.</p>`}
    `}
  </section>`;
}

// Forgot to clock out: ask when they left, send it to a lead.
function StaleSession({ mine }) {
  const { api, profile, settings } = useStore((s) => ({ api: s.api, profile: s.profile, settings: s.settings }));
  const start = new Date(mine.start);
  const suggested = new Date(Math.min(Date.now(), start.getTime() + 2 * HOUR));
  const [end, setEnd] = useState(toLocalInput(suggested));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const endD = fromLocalInput(end);
    if (!endD || endD <= start) { setErr('Pick a time after you clocked in.'); return; }
    if (endD > new Date()) { setErr('That time is in the future.'); return; }
    if (endD - start > 16 * HOUR) { setErr('That’s over 16 hours. Ask a lead to fix this session for you.'); return; }
    if (reason.trim().length < 3) { setErr('Add a short note for the lead.'); return; }
    setBusy(true); setErr('');
    try {
      await api.requestFix({ id: mine.entryId }, profile, { end: endD, reason: reason.trim(), hasPresence: true });
      toast('Sent. A lead will approve your session.');
    } catch (ex) { toastError(ex, 'That didn’t go through. Try again.'); setBusy(false); }
  };
  return html`<section class="clock stale" aria-label="Fix your last session">
    <${Contours} cx=${880} cy=${80} rings=${10} step=${70} />
    <p class="greet">${greeting()}, ${profile.name.split(' ')[0]}</p>
    <div class="state"><${Icon} name="alert" size=${18} />You’re still clocked in from ${fmtDateTime(start)}</div>
    <p class="sub" style="margin:10px 0 0;max-width:60ch">Sessions longer than ${settings.maxSessionHours} hours need a lead’s OK. Tell us when you actually left and we’ll send it for approval. Then you can clock in again.</p>
    <form class="controls" onSubmit=${submit}>
      <label class="field"><span>I left at</span><input class="input" type="datetime-local" value=${end} max=${toLocalInput(new Date())} min=${toLocalInput(start)} onInput=${(e) => setEnd(e.target.value)} required /></label>
      <label class="field" style="flex:1;min-width:220px"><span>Note for the lead</span><input class="input" value=${reason} maxlength="500" placeholder="Forgot to clock out after the build session" onInput=${(e) => setReason(e.target.value)} required /></label>
      <button class="clock-btn out" type="submit" disabled=${busy}>${busy ? 'Sending…' : 'Send for approval'}</button>
    </form>
    ${err && html`<p class="notice" role="alert">${err}</p>`}
  </section>`;
}

// ───────── Hours ─────────
function HoursPanel() {
  const { api, profile, settings } = useStore((s) => ({ api: s.api, profile: s.profile, settings: s.settings }));
  const presenceTick = useStore((s) => s.presence.find((p) => p.uid === s.profile?.uid)?.entryId || 'none');
  const term = termRange(settings);
  const weekFrom = startOfWeek(new Date());
  const from = term.from < weekFrom ? term.from : weekFrom;
  const res = useAsync(() => api.listMyEntries(profile.uid, from, addDays(startOfDay(new Date()), 1)), [api, profile.uid, presenceTick, settings.termStart]);
  const sums = useMemo(() => {
    const out = { week: 0, term: 0, pending: 0, sessions: 0 };
    (res.data || []).forEach((e) => {
      const ms = entryMs(e);
      if (e.status === 'complete') {
        if (new Date(e.start) >= term.from) { out.term += ms; out.sessions++; }
        if (new Date(e.start) >= weekFrom) out.week += ms;
      } else if (e.status === 'pending') out.pending += ms;
    });
    return out;
  }, [res.data]);
  const goal = Number(settings.termGoalHours) || 0;
  const pct = goal ? Math.min(100, (hours(sums.term) / goal) * 100) : 0;
  return html`<section class="panel" aria-labelledby="hours-h">
    <div class="panel-head"><h2 id="hours-h">Your hours</h2><a href="#/time">All sessions</a></div>
    ${res.loading && !res.data ? html`<div class="panel-body"><${Loading} /></div>` : html`
      <div class="readouts">
        <div class="readout"><div class="v">${fmtHours(hours(sums.week))}<small>h</small></div><div class="k">This week${settings.weeklyGoalHours ? `, goal ${settings.weeklyGoalHours} h` : ''}</div></div>
        <div class="readout"><div class="v">${fmtHours(hours(sums.term))}<small>h</small></div><div class="k">${settings.termName || 'This term'}</div></div>
      </div>
      <div class="panel-body" style="padding-top:4px">
        ${goal > 0 && html`<div class="row small" style="justify-content:space-between;margin-bottom:6px"><span class="muted">Term goal</span><span class="num">${fmtHours(hours(sums.term))} / ${goal} h</span></div>
          <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax=${goal} aria-valuenow=${fmtHours(hours(sums.term))} aria-label="Progress toward term goal"><span style=${{ width: pct + '%' }}></span></div>`}
        ${sums.pending > 0 && html`<p class="small" style="margin:10px 0 0;color:var(--warn)">+${fmtHours(hours(sums.pending))} h waiting for a lead’s approval</p>`}
      </div>`}
  </section>`;
}

// ───────── Who's in the lab ─────────
function LabPanel() {
  const { presence, maxH } = useStore((s) => ({ presence: s.presence, maxH: s.settings.maxSessionHours || 10 }));
  const now = useNow(30000);
  // Sessions past the limit are forgotten clock-outs, not people in the lab.
  const list = presence.filter((p) => now - new Date(p.start) <= maxH * 3600e3).sort((a, b) => new Date(a.start) - new Date(b.start));
  return html`<section class="panel" aria-labelledby="lab-h">
    <div class="panel-head"><h2 id="lab-h">In the lab now</h2><span class="num" style="font-size:20px">${list.length}</span></div>
    <div class="panel-body">
      ${list.length ? html`<div class="lab-list">${list.slice(0, 8).map((p) => {
        const act = activityById(p.activityId);
        const mins = Math.round((now - new Date(p.start)) / 60000);
        return html`<a class="person" key=${p.uid} href=${href('/members/' + p.uid)} style="color:inherit;text-decoration:none">
          <${Avatar} person=${p} size=${30} />
          <span class="grow" style="min-width:0"><b class="small" style="display:block">${p.name}</b><span class="tiny muted">${act ? act.name : 'Working'}</span></span>
          <span class="tiny muted nowrap">${mins < 60 ? mins + ' min' : Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min'}</span></a>`;
      })}${list.length > 8 ? html`<p class="small muted" style="margin:8px 0 0">and ${list.length - 8} more</p>` : null}</div>`
      : html`<p class="muted" style="margin:6px 0 4px">Nobody’s clocked in right now.</p>`}
    </div>
  </section>`;
}

// ───────── For leads: things waiting ─────────
function ReviewPanel() {
  const { pendingFixes, pendingMembers, profile, presence, settings } = useStore((s) => ({ pendingFixes: s.pendingFixes, pendingMembers: s.pendingMembers, profile: s.profile, presence: s.presence, settings: s.settings }));
  const stale = presence.filter((p) => Date.now() - new Date(p.start) > (settings.maxSessionHours || 10) * HOUR);
  const fixes = pendingFixes.filter((f) => f.uid !== profile.uid || isAdmin(profile));
  if (!fixes.length && !pendingMembers.length && !stale.length) return null;
  return html`<section class="panel" style="margin-top:16px" aria-labelledby="rev-h">
    <div class="panel-head"><h2 id="rev-h">Waiting on you</h2></div>
    <ul class="list list-flush" style="padding-bottom:6px">
      ${fixes.length > 0 && html`<li><${Icon} name="clock" size=${20} /><span class="grow"><b>${plural(fixes.length, 'session')} to approve</b><div class="meta">Members who forgot to clock out</div></span><a class="btn btn-sm" href="#/time/approvals">Review</a></li>`}
      ${stale.length > 0 && html`<li><${Icon} name="alert" size=${20} /><span class="grow"><b>${plural(stale.length, 'person', 'people')} still clocked in from earlier</b><div class="meta">Over ${settings.maxSessionHours} hours. They’ll be asked to fix it next time they open the portal.</div></span><a class="btn btn-sm" href="#/time/approvals">See who</a></li>`}
      ${isAdmin(profile) && pendingMembers.length > 0 && html`<li><${Icon} name="users" size=${20} /><span class="grow"><b>${plural(pendingMembers.length, 'person', 'people')} asked to join</b><div class="meta">${pendingMembers.slice(0, 3).map((m) => m.name).join(', ')}</div></span><a class="btn btn-sm" href="#/admin/members">Review</a></li>`}
    </ul>
  </section>`;
}

// ───────── Announcements ─────────
function NewsPanel() {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const [items, setItems] = useState(null);
  useEffect(() => api.watchAnnouncements(setItems, () => setItems([])), [api]);
  const shown = (items || []).filter((a) => !a.hidden && (!a.subteams?.length || a.subteams.some((s) => profile.subteams?.includes(s)) || isLead(profile)))
    .sort((a, b) => (!!b.pinned - !!a.pinned) || (new Date(b.createdAt) - new Date(a.createdAt))).slice(0, 3);
  return html`<section class="panel" aria-labelledby="news-h">
    <div class="panel-head"><h2 id="news-h">Announcements</h2><a href="#/announcements">See all</a></div>
    <div class="panel-body">
      ${!items ? html`<${Loading} />` : shown.length ? html`<ul class="list">${shown.map((a) => html`<li key=${a.id}>
        <span class="grow"><div class="row" style="gap:8px">${a.pinned && html`<${Icon} name="pin" size=${15} label="Pinned" />`}<span class="title">${a.title}</span></div>
          <div class="meta">${a.authorName}${a.source === 'discord' ? ` in #${a.discord?.channelName || 'Discord'}` : ''}, ${relTime(a.createdAt)}</div>
          <div class="small clamp-2" style="margin-top:4px;color:var(--text-2)"><${Markdown} text=${a.body.split('\n\n')[0]} class="" /></div></span></li>`)}</ul>`
      : html`<p class="muted" style="margin:6px 0">No announcements yet.</p>`}
    </div>
  </section>`;
}

// ───────── Coming up ─────────
export function DateBlock({ date }) {
  return html`<div class="dateblock" aria-hidden="true"><div class="m">${fmtMonShort(date)}</div><div class="d">${new Date(date).getDate()}</div></div>`;
}
function UpcomingPanel({ events }) {
  const list = (events.data || []).filter((e) => new Date(e.end) >= new Date()).slice(0, 4);
  return html`<section class="panel" aria-labelledby="up-h">
    <div class="panel-head"><h2 id="up-h">Coming up</h2><a href="#/calendar">Calendar</a></div>
    <div class="panel-body">
      ${events.loading && !events.data ? html`<${Loading} />` : list.length ? html`<ul class="list">${list.map((e) => html`<li key=${e.id}>
        <${DateBlock} date=${e.start} />
        <span class="grow"><span class="title">${e.title}</span><div class="meta">${fmtDate(e.start)}, ${fmtTime(e.start)} – ${fmtTime(e.end)}${e.location ? ` in ${e.location}` : ''}</div></span></li>`)}</ul>`
      : html`<p class="muted" style="margin:6px 0">Nothing on the calendar yet.</p>`}
    </div>
  </section>`;
}

// ───────── My tasks ─────────
function TasksPanel() {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const spaces = useStore((s) => visibleSpaces(s));
  const spaceIds = spaces.map((s) => s.id).join(',');
  const res = useAsync(() => api.listMyTasks(profile.uid, spaceIds ? spaceIds.split(',') : []), [api, profile.uid, spaceIds]);
  const open = (res.data || []).filter((t) => t.status !== 'done').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 6);
  const todayIso = isoDate(new Date());
  return html`<section class="panel" style="margin-top:16px" aria-labelledby="tasks-h">
    <div class="panel-head"><h2 id="tasks-h">Your tasks</h2><a href="#/tasks">All tasks</a></div>
    <div class="panel-body">
      ${res.loading && !res.data ? html`<${Loading} />` : open.length ? html`<ul class="list">${open.map((t) => {
        const sp = spaces.find((s) => s.id === t.spaceId);
        return html`<li key=${t.id}><${Icon} name="tasks" size=${20} />
          <span class="grow"><a class="title" href=${href(`/s/${t.spaceId}/board?task=${t.id}`)}>${t.title}</a><div class="meta">${sp ? `#${spaceLabel(sp)}` : ''}</div></span>
          ${t.due && html`<span class=${'small nowrap ' + (t.due < todayIso ? 'strong' : 'muted')} style=${t.due < todayIso ? 'color:var(--bad)' : ''}>${t.due < todayIso ? 'Overdue, ' : 'Due '}${fmtShortDate(t.due + 'T12:00:00')}</span>`}
        </li>`;
      })}</ul>` : html`<p class="muted" style="margin:6px 0">Nothing assigned to you. Pick something up from a space’s task board.</p>`}
    </div>
  </section>`;
}
