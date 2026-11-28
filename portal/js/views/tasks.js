// Tasks: a kanban board per space, plus "My tasks" across every space.
import { html, useState, useEffect, useMemo, useRef, Icon, Avatar, Modal, openModal, Field, MultiSelect, Seg, Loading, Empty, useAsync, toast, toastError, confirmDialog } from '../lib/ui.js';
import { useStore, setState, getState, isLead, spaceById, canSeeSpace, visibleSpaces, spaceLabel } from '../lib/store.js';
import { useRoute, href, go } from '../lib/router.js';
import { isoDate, parseIsoDate, fmtShortDate, addDays, startOfDay, relTime } from '../lib/time.js';
import { Markdown, plural } from '../lib/text.js';
import { useTitle, SpaceIcon } from './common.js';
import { NoAccess } from './spaces.js';

export const COLUMNS = [['todo', 'To do'], ['doing', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']];
const PRIORITY = { high: 'High', normal: 'Normal', low: 'Low' };

export function useMembers() {
  const api = useStore((s) => s.api);
  const cached = useStore((s) => s.membersCache);
  useEffect(() => { if (!getState().membersCache) api.listMembers().then((m) => setState({ membersCache: m })).catch(() => {}); }, [api]);
  return cached || [];
}

export const dueLabel = (due, status) => {
  if (!due) return null;
  if (status === 'done') return ['Was due ' + fmtShortDate(parseIsoDate(due)), false];
  const today = isoDate(new Date());
  if (due < today) return ['Overdue, ' + fmtShortDate(parseIsoDate(due)), true];
  if (due === today) return ['Due today', false];
  return ['Due ' + fmtShortDate(parseIsoDate(due)), false];
};

// ───────── My tasks ─────────
export function MyTasks() {
  useTitle('Tasks');
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const spaces = useStore((s) => visibleSpaces(s));
  const spaceIds = spaces.map((s) => s.id).join(',');
  const [tick, setTick] = useState(0);
  const res = useAsync(() => api.listMyTasks(profile.uid, spaceIds ? spaceIds.split(',') : []), [api, profile.uid, tick, spaceIds]);
  const tasks = res.data || [];
  // A subtask shows its main task's name, which may not be on this list
  const parents = useAsync(async () => {
    const need = [...new Set(tasks.filter((t) => t.parentId).map((t) => `${t.spaceId}/${t.parentId}`))];
    const got = await Promise.all(need.map((k) => api.getTask(...k.split('/')).catch(() => null)));
    return Object.fromEntries(got.filter(Boolean).map((t) => [t.id, t]));
  }, [api, res.data]);
  const today = isoDate(new Date()), weekOut = isoDate(addDays(new Date(), 7));
  const groups = [
    ['Overdue', tasks.filter((t) => t.status !== 'done' && t.due && t.due < today)],
    ['Due this week', tasks.filter((t) => t.status !== 'done' && t.due && t.due >= today && t.due <= weekOut)],
    ['Later', tasks.filter((t) => t.status !== 'done' && t.due && t.due > weekOut)],
    ['No due date', tasks.filter((t) => t.status !== 'done' && !t.due)],
    ['Done', tasks.filter((t) => t.status === 'done').slice(0, 10)],
  ].filter(([, l]) => l.length);
  return html`<div class="content">
    <div class="page-head"><div><h1>Tasks</h1><p>Everything assigned to you, across every space. Each space also has its own board.</p></div></div>
    <div class="chips" style="margin-bottom:20px">${spaces.map((s) => html`<a key=${s.id} class="chip chip-toggle" style="text-decoration:none" href=${href(`/s/${s.id}/board`)}><${SpaceIcon} space=${s} size=${14} />${spaceLabel(s)}</a>`)}</div>
    ${res.loading && !res.data ? html`<${Loading} />` : !groups.length
      ? html`<div class="panel"><${Empty} title="Nothing assigned to you">Open a space’s board to pick something up, or ask a lead what needs doing.</${Empty}></div>`
      : groups.map(([label, list]) => html`<section key=${label} style="margin-bottom:20px">
          <h2 class="section-title" style="margin-top:0">${label} <span class="muted small" style="font-weight:500">${list.length}</span></h2>
          <div class="panel"><ul class="list list-flush">${list.map((t) => {
            const sp = spaceById(t.spaceId); const d = dueLabel(t.due, t.status);
            return html`<li key=${t.id}>
              <button class="btn btn-sm btn-icon btn-quiet" aria-label=${t.status === 'done' ? 'Mark not done' : 'Mark done'} title=${t.status === 'done' ? 'Mark not done' : 'Mark done'}
                onClick=${async () => { try { await api.saveTask({ id: t.id, spaceId: t.spaceId, status: t.status === 'done' ? 'todo' : 'done', order: t.order, completedAt: t.status === 'done' ? null : new Date() }, profile, { assigneeOnly: true }); setTick(tick + 1); } catch (e) { toastError(e); } }}>
                <${Icon} name=${t.status === 'done' ? 'check' : 'tasks'} size=${20} /></button>
              <span class="grow"><a class="title" href=${href(`/s/${t.spaceId}/board?task=${t.id}`)} style=${t.status === 'done' ? 'text-decoration:line-through;color:var(--text-3)' : ''}>${parents.data?.[t.parentId] && html`<span class="muted" style="font-weight:500">${parents.data[t.parentId].title} › </span>`}${t.title}</a>
                <div class="meta">${sp ? `#${spaceLabel(sp)}` : ''}${t.status !== 'todo' && t.status !== 'done' ? `, ${COLUMNS.find(([k]) => k === t.status)?.[1]}` : ''}</div></span>
              ${d && html`<span class="small nowrap" style=${d[1] ? 'color:var(--bad);font-weight:700' : 'color:var(--text-3)'}>${d[0]}</span>`}
            </li>`;
          })}</ul></div></section>`)}
  </div>`;
}

// ───────── Board ─────────
export function Board({ spaceId }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const space = useStore((s) => s.spaces.find((x) => x.id === spaceId));
  useTitle(space ? `${space.name} board` : 'Board');
  const route = useRoute();
  const members = useMembers();
  const [tasks, setTasks] = useState(null);
  const [mine, setMine] = useState(false);
  const [subCards, setSubCards] = useState(false);
  const [q, setQ] = useState('');
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);
  const allowed = canSeeSpace(space, profile);
  const canEdit = allowed && (isLead(profile) || !!space?.memberEdit);
  useEffect(() => (allowed ? api.watchTasks(spaceId, setTasks, (e) => { setTasks([]); toastError(e); }) : undefined), [api, spaceId, allowed]);

  // Open a task straight from a link (#/s/<space>/board?task=<id>)
  const opened = useRef(false);
  useEffect(() => {
    const id = route.query.get('task');
    if (id && tasks && !opened.current) {
      const t = tasks.find((x) => x.id === id);
      if (t) { opened.current = true; openTask(t, spaceId); }
    }
  }, [tasks]);

  if (!space) return html`<div class="content"><${Empty} title="This space doesn’t exist">It may have been deleted.</${Empty}></div>`;
  if (!allowed) return html`<div class="content"><${NoAccess} space=${space} /></div>`;
  // Subtasks live inside their main task's card unless "As cards" is on. "Mine" always shows the
  // ones assigned to you. A subtask whose main task is gone counts as a main task.
  const all = tasks || [];
  const byId = new Map(all.map((t) => [t.id, t]));
  const parentOf = (t) => (t.parentId && byId.get(t.parentId)) || null;
  const kids = {};
  all.forEach((t) => { if (parentOf(t)) (kids[t.parentId] ||= []).push(t); });
  const hit = (t) => !q || t.title.toLowerCase().includes(q.toLowerCase());
  const shown = all.filter((t) => {
    const mineOk = !mine || t.assignees?.includes(profile.uid);
    if (parentOf(t)) return (subCards || mine) && mineOk && hit(t);
    return mineOk && (hit(t) || (kids[t.id] || []).some(hit));
  });

  const move = async (t, status) => {
    if (t.status === status) return;
    const assignee = t.assignees?.includes(profile.uid);
    if (!canEdit && !assignee) { toast('Only leads and people on this task can move it.', { kind: 'bad' }); return; }
    setTasks((cur) => cur.map((x) => (x.id === t.id ? { ...x, status } : x)));
    try { await api.saveTask({ id: t.id, spaceId, status, order: Date.now(), completedAt: status === 'done' ? new Date() : null }, profile, { assigneeOnly: !canEdit }); }
    catch (e) { toastError(e); }
  };

  return html`<div class="content wide">
    <div class="crumbs"><a href=${href('/s/' + space.id)} class="row" style="gap:4px"><${SpaceIcon} space=${space} size=${15} />${space.name}</a><${Icon} name="chevronRight" /><span>Task board</span></div>
    <div class="page-head">
      <div><h1>#${space.name} tasks</h1><p>${canEdit ? 'Drag cards between columns. Click a card for details.' : 'Leads manage this board. You can move tasks assigned to you.'}</p></div>
      <div class="actions">
        <div class="search" style="width:220px"><${Icon} name="search" /><input class="input" type="search" placeholder="Find a task" value=${q} onInput=${(e) => setQ(e.target.value)} /></div>
        <${Seg} label="Show" value=${mine ? 'mine' : 'all'} onChange=${(v) => setMine(v === 'mine')} options=${[['all', 'Everyone'], ['mine', 'Mine']]} />
        ${Object.keys(kids).length > 0 && html`<${Seg} label="Subtasks" value=${subCards ? 'cards' : 'inside'} onChange=${(v) => setSubCards(v === 'cards')} options=${[['inside', 'Inside their task'], ['cards', 'As cards']]} />`}
      </div>
    </div>
    ${!tasks ? html`<${Loading} />` : html`<div class="board">
      ${COLUMNS.map(([key, label]) => {
        const list = shown.filter((t) => t.status === key).sort((a, b) => (a.order || 0) - (b.order || 0));
        return html`<section key=${key} class=${'column' + (over === key ? ' drop' : '')} aria-label=${label}
          onDragOver=${(e) => { if (dragId) { e.preventDefault(); setOver(key); } }}
          onDragLeave=${(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}
          onDrop=${(e) => { e.preventDefault(); setOver(null); const t = (tasks || []).find((x) => x.id === dragId); setDragId(null); if (t) move(t, key); }}>
          <div class="column-head">${label}<span class="n">${list.length}</span></div>
          ${canEdit && html`<${QuickAdd} spaceId=${spaceId} status=${key} />`}
          ${list.map((t) => html`<${Card} key=${t.id} t=${t} members=${members} dragging=${dragId === t.id} parent=${parentOf(t)} kids=${kids[t.id]}
            draggable=${canEdit || t.assignees?.includes(profile.uid)} onDragStart=${() => setDragId(t.id)} onDragEnd=${() => { setDragId(null); setOver(null); }} spaceId=${spaceId} />`)}
          ${!list.length && html`<p class="tiny muted" style="padding:4px 6px;margin:0">${key === 'done' ? 'Finished work lands here.' : 'Nothing here.'}</p>`}
        </section>`;
      })}
    </div>`}
  </div>`;
}

function Card({ t, members, dragging, draggable, onDragStart, onDragEnd, spaceId, parent, kids }) {
  const d = dueLabel(t.due, t.status);
  const done = (kids || []).filter((k) => k.status === 'done').length;
  const people = (t.assignees || []).map((uid) => members.find((m) => m.uid === uid) || { uid, name: '?' });
  return html`<button class=${'task' + (dragging ? ' dragging' : '')} draggable=${draggable ? 'true' : 'false'}
    onDragStart=${(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); onDragStart(); }} onDragEnd=${onDragEnd}
    onClick=${() => openTask(t, spaceId)}>
    ${parent && html`<span class="t-parent">Part of ${parent.title}</span>`}
    <span class="t">${t.priority === 'high' && html`<span class="prio-high" title="High priority">! </span>`}${t.title}</span>
    ${kids?.length > 0 && html`<span class="t-progress"><span class="bar" aria-hidden="true"><i style=${`width:${Math.round((done / kids.length) * 100)}%`}></i></span>${done} of ${kids.length} subtasks done</span>`}
    <span class="foot">
      ${d && html`<span class=${'due' + (d[1] && t.status !== 'done' ? ' late' : '')}>${d[0]}</span>`}
      <span class="spacer"></span>
      ${people.length > 0 && html`<span class="avatars">${people.slice(0, 3).map((p) => html`<${Avatar} key=${p.uid} person=${p} size=${22} />`)}</span>`}
    </span>
  </button>`;
}

function QuickAdd({ spaceId, status }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const add = async () => {
    if (!title.trim()) { setOpen(false); return; }
    try {
      await api.saveTask({ spaceId, title: title.trim(), description: '', status, assignees: [], due: null, priority: 'normal', labels: [], order: Date.now(), completedAt: null }, profile);
      setTitle('');
    } catch (e) { toastError(e); }
  };
  if (!open) return html`<button class="btn btn-sm btn-quiet add-task" onClick=${() => setOpen(true)}><${Icon} name="plus" />Add task</button>`;
  return html`<div style="margin-bottom:8px"><input class="input" autofocus value=${title} placeholder="Task name, then Enter" maxlength="200"
    onInput=${(e) => setTitle(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setTitle(''); setOpen(false); } }} onBlur=${() => { if (!title.trim()) setOpen(false); }} /></div>`;
}

export function openTask(t, spaceId) { openModal((close) => html`<${TaskEditor} task=${t} spaceId=${spaceId} close=${close} />`, {}); }

function TaskEditor({ task, spaceId, close }) {
  const { api, profile } = useStore((s) => ({ api: s.api, profile: s.profile }));
  const space = useStore((s) => s.spaces.find((x) => x.id === spaceId));
  const members = useMembers();
  const canEdit = canSeeSpace(space, profile) && (isLead(profile) || !!space?.memberEdit);
  // The board, live: this task's subtasks, its main task and the "Part of" choices
  const [board, setBoard] = useState([]);
  useEffect(() => api.watchTasks(spaceId, setBoard, () => setBoard([])), [api, spaceId]);
  const subs = board.filter((x) => x.parentId === task.id).sort((a, b) => (a.order || 0) - (b.order || 0));
  const parent = board.find((x) => x.id === task.parentId) || null;
  const mains = board.filter((x) => x.id !== task.id && !x.parentId).sort((a, b) => a.title.localeCompare(b.title));
  const [f, setF] = useState({ title: task.title, description: task.description || '', status: task.status, assignees: task.assignees || [], due: task.due || '', priority: task.priority || 'normal', parentId: task.parentId || '' });
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newSub, setNewSub] = useState('');
  const mayDelete = (t) => isLead(profile) || (canEdit && t.createdBy === profile.uid);
  const switchTo = (t) => { close(); openTask(t, spaceId); };
  const save = async () => {
    if (!f.title.trim()) return;
    setBusy(true);
    try {
      if (canEdit) await api.saveTask({ id: task.id, spaceId, title: f.title.trim(), description: f.description.trim(), status: f.status, assignees: f.assignees, due: f.due || null, priority: f.priority, labels: task.labels || [], order: task.order || Date.now(), completedAt: f.status === 'done' ? (task.completedAt || new Date()) : null, parentId: subs.length ? null : (f.parentId || null) }, profile);
      else await api.saveTask({ id: task.id, spaceId, status: f.status, order: task.order || Date.now(), completedAt: f.status === 'done' ? new Date() : null }, profile, { assigneeOnly: true });
      toast('Task saved.'); close();
    } catch (e) { toastError(e); setBusy(false); }
  };
  const remove = async () => {
    const n = subs.length;
    const body = n ? `“${task.title}” and its ${n === 1 ? 'subtask' : n + ' subtasks'} will be removed from the board.` : `“${task.title}” will be removed from the board.`;
    if (!(await confirmDialog({ title: 'Delete this task?', body, confirmLabel: 'Delete task', danger: true }))) return;
    // Subtasks you couldn't delete on their own stay on the board as tasks of their own
    const keep = subs.filter((x) => !mayDelete(x));
    try {
      await api.deleteTask({ id: task.id, spaceId }, { remove: subs.filter(mayDelete).map((x) => x.id), detach: keep.map((x) => x.id) });
      toast(keep.length ? `Task deleted. ${keep.length === 1 ? 'One subtask was' : keep.length + ' subtasks were'} made by someone else, so ${keep.length === 1 ? 'it stays' : 'they stay'} as a task of ${keep.length === 1 ? 'its' : 'their'} own.` : 'Task deleted.');
      close();
    } catch (e) { toastError(e); }
  };
  const toggleSub = async (x) => {
    try { await api.saveTask({ id: x.id, spaceId, status: x.status === 'done' ? 'todo' : 'done', order: x.order || Date.now(), completedAt: x.status === 'done' ? null : new Date() }, profile, { assigneeOnly: !canEdit }); }
    catch (e) { toastError(e); }
  };
  const addSub = async () => {
    const title = newSub.trim();
    if (!title) return;
    try {
      await api.saveTask({ spaceId, title, description: '', status: 'todo', assignees: [], due: null, priority: 'normal', labels: [], order: Date.now(), completedAt: null, parentId: task.id }, profile);
      setNewSub('');
    } catch (e) { toastError(e); }
  };
  const canDelete = mayDelete(task);
  const canMove = canEdit || (task.assignees || []).includes(profile.uid);
  const memberOpts = members.slice().sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ value: m.uid, label: m.name }));
  const person = (uid) => members.find((m) => m.uid === uid) || { uid, name: '?' };
  const doneN = subs.filter((x) => x.status === 'done').length;
  return html`<${Modal} title=${canEdit ? (task.parentId ? 'Subtask' : 'Task') : task.title} onClose=${close} wide
    footer=${html`${canDelete && html`<button class="btn btn-danger left" onClick=${remove}><${Icon} name="trash" />Delete</button>`}
      ${canMove ? html`<button class="btn" onClick=${close}>Cancel</button><button class="btn btn-primary" onClick=${save} disabled=${busy}>Save task</button>` : html`<button class="btn" onClick=${close}>Close</button>`}`}>
    ${parent && html`<p class="small" style="margin:0 0 14px">Part of <button class="link-btn" onClick=${() => switchTo(parent)}>${parent.title}</button></p>`}
    <div class="form-grid">
      ${canEdit && html`<${Field} label="Title" full><input class="input" value=${f.title} maxlength="200" onInput=${(e) => setF({ ...f, title: e.target.value })} /></${Field}>`}
      <${Field} label="Status"><select class="select" value=${f.status} disabled=${!canMove} onChange=${(e) => setF({ ...f, status: e.target.value })}>${COLUMNS.map(([k, l]) => html`<option value=${k} key=${k}>${l}</option>`)}</select></${Field}>
      <${Field} label="Due date"><input class="input" type="date" value=${f.due} disabled=${!canEdit} onInput=${(e) => setF({ ...f, due: e.target.value })} /></${Field}>
      <div class="field"><span>Assigned to</span>${canEdit ? html`<${MultiSelect} options=${memberOpts} value=${f.assignees} onChange=${(v) => setF({ ...f, assignees: v.slice(0, 12) })} allLabel="Nobody yet" searchable />`
        : html`<div class="avatars">${f.assignees.map((uid) => html`<${Avatar} key=${uid} person=${person(uid)} size=${28} />`)}</div>`}</div>
      <${Field} label="Priority"><select class="select" value=${f.priority} disabled=${!canEdit} onChange=${(e) => setF({ ...f, priority: e.target.value })}>${Object.entries(PRIORITY).map(([k, l]) => html`<option value=${k} key=${k}>${l}</option>`)}</select></${Field}>
      ${canEdit && !subs.length && (mains.length > 0 || f.parentId) && html`<${Field} label="Part of" hint="Put this under a bigger task, as one of its steps.">
        <select class="select" value=${f.parentId} onChange=${(e) => setF({ ...f, parentId: e.target.value })}>
          <option value="">Nothing. It’s a main task</option>${mains.map((m) => html`<option key=${m.id} value=${m.id}>${m.title}</option>`)}</select></${Field}>`}
      <div class="field full"><span>Details</span>
        ${canEdit && (editing || !f.description)
          ? html`<textarea class="textarea" value=${f.description} maxlength="4000" placeholder="What does done look like? Links, part numbers, drawings…" onInput=${(e) => setF({ ...f, description: e.target.value })}></textarea>`
          : html`<div class="panel panel-pad" style="padding:12px 14px" onDblClick=${() => canEdit && setEditing(true)}>${f.description ? html`<${Markdown} text=${f.description} />` : html`<span class="muted">No details.</span>`}
              ${canEdit && html`<div><button class="link-btn small" onClick=${() => setEditing(true)}>Edit details</button></div>`}</div>`}
      </div>
      ${!task.parentId && (subs.length > 0 || canEdit) && html`<div class="field full"><span>Subtasks${subs.length > 0 && html` <span class="muted" style="font-weight:500">${doneN} of ${subs.length} done</span>`}</span>
        ${subs.length > 0 && html`<ul class="subtasks">${subs.map((x) => {
          const d = dueLabel(x.due, x.status);
          const mine = canEdit || (x.assignees || []).includes(profile.uid);
          const st = x.status === 'doing' || x.status === 'blocked' ? COLUMNS.find(([k]) => k === x.status)[1] : '';
          return html`<li key=${x.id} class=${x.status === 'done' ? 'done' : ''}>
            <input type="checkbox" checked=${x.status === 'done'} disabled=${!mine} aria-label=${'Done: ' + x.title} onChange=${() => toggleSub(x)} />
            <button class="link-btn sub-title" onClick=${() => switchTo(x)}>${x.title}</button>
            ${st && html`<span class=${'tiny nowrap' + (x.status === 'blocked' ? ' late' : ' muted')}>${st}</span>`}
            <span class="avatars" aria-hidden="true">${(x.assignees || []).slice(0, 3).map((uid) => html`<${Avatar} key=${uid} person=${person(uid)} size=${22} />`)}</span>
            ${d && html`<span class=${'tiny nowrap' + (d[1] ? ' late' : ' muted')}>${d[0]}</span>`}
          </li>`;
        })}</ul>`}
        ${canEdit && html`<input class="input" value=${newSub} maxlength="200" placeholder="Add a subtask, then press Enter" aria-label="New subtask"
          onInput=${(e) => setNewSub(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } }} />`}
      </div>`}
    </div>
    <p class="tiny muted" style="margin:12px 0 0">Created ${relTime(task.createdAt)}${task.updatedAt ? `, updated ${relTime(task.updatedAt)}` : ''}</p>
  </${Modal}>`;
}
