// The top of a space: where its tasks stand and what's due soon, and, when the space is linked to a
// subteam (Space settings), that team's upcoming events, who's clocked in for it and who's on it.
import { html, useState, useEffect, Icon, Avatar, Loading, useAsync, useNow, toastError } from '../lib/ui.js';
import { useStore, subteamById, isLead } from '../lib/store.js';
import { href } from '../lib/router.js';
import { isoDate, addDays, startOfDay, fmtDate, fmtTime } from '../lib/time.js';
import { COLUMNS, useMembers, dueLabel } from './tasks.js';

const SOON_DAYS = 14;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ───────── Tasks: the status split, then everything due in the next two weeks ─────────
export function SpaceTasks({ space, canEdit }) {
  const api = useStore((s) => s.api);
  const members = useMembers();
  const [tasks, setTasks] = useState(null);
  useEffect(() => api.watchTasks(space.id, setTasks, (e) => { setTasks([]); toastError(e); }), [api, space.id]);
  const board = href(`/s/${space.id}/board`);
  const head = html`<div class="panel-head"><h2 id="sp-tasks-h">Tasks</h2><a href=${board}>Task board</a></div>`;
  if (!tasks) return html`<section class="panel" aria-labelledby="sp-tasks-h">${head}<div class="panel-body"><${Loading} /></div></section>`;

  const today = isoDate(new Date()), weekOut = isoDate(addDays(new Date(), 7)), soon = isoDate(addDays(new Date(), SOON_DAYS));
  const open = tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due && t.due < today);
  const thisWeek = open.filter((t) => t.due && t.due >= today && t.due <= weekOut);
  const blocked = open.filter((t) => t.status === 'blocked');
  const due = open.filter((t) => t.due && t.due <= soon).sort((a, b) => a.due.localeCompare(b.due) || (a.order || 0) - (b.order || 0));
  const undated = open.filter((t) => !t.due).length;
  const counts = COLUMNS.map(([key, label]) => ({ key, label, n: tasks.filter((t) => (t.status || 'todo') === key).length }));
  const facts = [
    overdue.length && html`<span class="bad-text">${overdue.length} overdue</span>`,
    thisWeek.length && `${thisWeek.length} due this week`,
    blocked.length && `${blocked.length} blocked`,
  ].filter(Boolean);

  if (!tasks.length) {
    return html`<section class="panel" aria-labelledby="sp-tasks-h">${head}<div class="panel-body">
      <p class="muted" style="margin:6px 0">${canEdit ? html`No tasks yet. <a href=${board}>Add the first one on the board.</a>` : 'No tasks yet.'}</p>
    </div></section>`;
  }
  const shown = due.slice(0, 6);
  return html`<section class="panel" aria-labelledby="sp-tasks-h">${head}<div class="panel-body">
    <p class="task-summary"><b class="big">${open.length}</b><span>open</span>${facts.map((f, i) => html`<span key=${i} class="fact">${f}</span>`)}</p>
    <div class="status-bar" aria-hidden="true">${counts.filter((c) => c.n).map((c) => html`<span key=${c.key} class=${'st-' + c.key} style=${`flex:${c.n}`} title=${`${c.label}: ${c.n}`}></span>`)}</div>
    <ul class="status-legend">${counts.map((c) => html`<li key=${c.key}><i class=${'st-' + c.key}></i>${c.label} <b>${c.n}</b></li>`)}</ul>
    <h3 class="sub">Due in the next two weeks</h3>
    ${shown.length ? html`<ul class="list due-list">${shown.map((t) => {
      const [label, late] = dueLabel(t.due, t.status);
      const people = (t.assignees || []).map((uid) => members.find((m) => m.uid === uid)).filter(Boolean);
      const status = COLUMNS.find(([k]) => k === (t.status || 'todo'))?.[1] || 'To do';
      const main = t.parentId && tasks.find((x) => x.id === t.parentId);
      return html`<li key=${t.id}>
        <i class=${'st-dot st-' + (t.status || 'todo')} title=${status}></i>
        <span class="grow"><a class="title" href=${href(`/s/${space.id}/board?task=${t.id}`)}>${t.priority === 'high' && html`<span class="prio-high" title="High priority">! </span>`}${t.title}</a>
          <div class="meta">${status}${people.length ? ` · ${people.map((p) => p.name.split(' ')[0]).join(', ')}` : ' · Nobody yet'}${main ? ` · Part of ${main.title}` : ''}</div></span>
        <span class="avatars" aria-hidden="true">${people.slice(0, 3).map((p) => html`<${Avatar} key=${p.uid} person=${p} size=${24} />`)}</span>
        <span class=${'small nowrap due' + (late ? ' late' : '')}>${label}</span>
      </li>`;
    })}</ul>` : html`<p class="muted" style="margin:8px 0 4px">Nothing due in the next two weeks.</p>`}
    ${(due.length > shown.length || undated) ? html`<p class="small muted" style="margin:10px 0 0">${[
      due.length > shown.length && `${due.length - shown.length} more due soon`,
      undated && `${plural(undated, 'open task has', 'open tasks have')} no due date`,
    ].filter(Boolean).join('. ')}. <a href=${board}>See the board</a></p>` : null}
  </div></section>`;
}

// ───────── The linked subteam: events, who's in, who's on it ─────────
export function SpaceTeam({ space }) {
  const team = subteamById(space.subteamId);
  if (!team) return null;
  return html`<${TeamEvents} space=${space} team=${team} /><${TeamWorking} space=${space} team=${team} /><${TeamPeople} space=${space} team=${team} />`;
}

function TeamEvents({ space, team }) {
  const api = useStore((s) => s.api);
  const res = useAsync(() => api.listEvents(startOfDay(new Date()), addDays(startOfDay(new Date()), 45)), [api]);
  // This team's events first, plus the next club-wide one (no subteam), so a weekly all-hands doesn't crowd them out
  const ahead = (res.data || []).filter((e) => new Date(e.end) >= new Date());
  const own = ahead.filter((e) => (e.subteams || []).includes(space.subteamId)).slice(0, 3);
  const club = ahead.filter((e) => !(e.subteams || []).length).slice(0, own.length ? 1 : 3);
  const list = [...own, ...club].sort((x, y) => new Date(x.start) - new Date(y.start)).slice(0, 4);
  return html`<section class="panel" aria-labelledby="sp-events-h">
    <div class="panel-head"><h2 id="sp-events-h">Coming up</h2><a href="#/calendar">Calendar</a></div>
    <div class="panel-body">${res.loading && !res.data ? html`<${Loading} />` : list.length ? html`<ul class="list">${list.map((e) => html`<li key=${e.id}>
      <div class="dateblock" aria-hidden="true"><div class="m">${new Date(e.start).toLocaleString('en-US', { month: 'short' })}</div><div class="d">${new Date(e.start).getDate()}</div></div>
      <span class="grow"><span class="title">${e.title}</span><div class="meta">${fmtDate(e.start)}, ${fmtTime(e.start)}${e.location ? ` · ${e.location}` : ''}${(e.subteams || []).length ? '' : html` · <span class="nowrap">Club-wide</span>`}</div></span></li>`)}</ul>`
      : html`<p class="muted" style="margin:6px 0">No ${team.name} events in the next six weeks.</p>`}</div>
  </section>`;
}

function TeamWorking({ space, team }) {
  const { presence, maxH } = useStore((s) => ({ presence: s.presence, maxH: s.settings.maxSessionHours || 10 }));
  const now = useNow(60000);
  const list = presence.filter((p) => p.subteamId === space.subteamId && now - new Date(p.start) <= maxH * 3600e3);
  return html`<section class="panel" aria-labelledby="sp-in-h">
    <div class="panel-head"><h2 id="sp-in-h">Working on ${team.name} now</h2><span class="num" style="font-size:20px">${list.length}</span></div>
    <div class="panel-body">${list.length ? html`<div class="lab-list">${list.map((p) => {
      const mins = Math.max(0, Math.round((now - new Date(p.start)) / 60000));
      return html`<a class="person" key=${p.uid} href=${href('/members/' + p.uid)} style="color:inherit;text-decoration:none">
        <${Avatar} person=${p} size=${28} /><b class="small grow">${p.name}</b>
        <span class="tiny muted nowrap">${mins < 60 ? mins + ' min' : Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min'}</span></a>`;
    })}</div>` : html`<p class="muted" style="margin:6px 0">Nobody’s clocked in for ${team.name} right now.</p>`}</div>
  </section>`;
}

function TeamPeople({ space, team }) {
  const members = useMembers();
  const people = members.filter((m) => (m.subteams || []).includes(space.subteamId))
    .sort((a, b) => Number(isLead(b)) - Number(isLead(a)) || a.name.localeCompare(b.name));
  return html`<section class="panel" aria-labelledby="sp-team-h">
    <div class="panel-head"><h2 id="sp-team-h">${team.name} team</h2><span class="small muted">${people.length}</span></div>
    <div class="panel-body">${people.length ? html`<ul class="team-list">${people.slice(0, 10).map((m) => html`<li key=${m.uid}>
      <a href=${href('/members/' + m.uid)} class="person"><${Avatar} person=${m} size=${28} />
        <span class="grow" style="min-width:0"><b class="small" style="display:block">${m.name}</b><span class="tiny muted">${m.title || (isLead(m) ? 'Lead' : m.major || 'Member')}</span></span></a></li>`)}</ul>
      ${people.length > 10 ? html`<p class="small muted" style="margin:8px 0 0">and ${people.length - 10} more on <a href="#/members">Members</a></p>` : null}`
      : html`<p class="muted" style="margin:6px 0">Nobody has picked ${team.name} on their profile yet.</p>`}</div>
  </section>`;
}
