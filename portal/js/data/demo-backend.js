// Demo backend: the same API as firebase-backend.js, backed by sample data kept in this
// browser only (localStorage). Used before Firebase is set up, and for trying things safely.
import { buildSeed, PERSONAS, VISITOR, SPACE_ICONS } from './demo-seed.js';
import { descendants } from './tree.js';

// Bumped whenever the sample data changes shape, so every browser starts over with the new set.
const KEY = 'er-portal-demo-v4';
const PERSONA_KEY = 'er-portal-demo-persona';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const clone = (v) => (v instanceof Date ? new Date(v) : Array.isArray(v) ? v.map(clone)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 10);

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return addIcons(JSON.parse(raw, (k, v) => (typeof v === 'string' && ISO.test(v) ? new Date(v) : v)));
  } catch { /* storage blocked or corrupt: start fresh */ }
  return null;
}

// Sample data saved before spaces had icons gets them, keeping everything the visitor changed.
function addIcons(db) {
  Object.entries(SPACE_ICONS).forEach(([id, icon]) => {
    const s = db.spaces?.[id];
    if (s && !('icon' in s) && !('iconImage' in s)) s.icon = icon;
  });
  return db;
}

export function createDemoBackend() {
  let db = load() || buildSeed();
  const subs = new Map(); // collection -> Set<fn>
  let authCb = null;
  let persona = (() => { try { return localStorage.getItem(PERSONA_KEY) || 'admin'; } catch { return 'admin'; } })();
  // Signed out until the visitor presses "Sign in" once in this tab, so the demo shows the sign-in page.
  const IN_KEY = 'er-portal-demo-signed-in';
  let signedIn = (() => { try { return sessionStorage.getItem(IN_KEY) === '1'; } catch { return false; } })();
  const setSignedIn = (v) => { signedIn = v; try { sessionStorage.setItem(IN_KEY, v ? '1' : '0'); } catch { /* ignore */ } };

  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };
  const emit = (...names) => { persist(); names.forEach((n) => (subs.get(n) || []).forEach((f) => f())); };
  const coll = (n) => (db[n] ||= {});
  const rows = (n) => Object.entries(coll(n)).map(([id, v]) => ({ id, ...clone(v) }));
  const one = (n, id) => (coll(n)[id] ? { id, ...clone(coll(n)[id]) } : null);
  const put = (n, id, v) => { coll(n)[id] = clone(v); };
  const patch = (n, id, p) => { coll(n)[id] = { ...coll(n)[id], ...clone(p) }; };
  function watch(names, compute, cb) {
    const run = () => { try { cb(compute()); } catch (e) { console.error(e); } };
    names.forEach((n) => { if (!subs.has(n)) subs.set(n, new Set()); subs.get(n).add(run); });
    setTimeout(run, 60);
    return () => names.forEach((n) => subs.get(n)?.delete(run));
  }
  const personaUser = () => {
    const p = PERSONAS.find((x) => x.key === persona) || PERSONAS[0];
    if (p.key === 'visitor') return { ...VISITOR, emailVerified: true };
    const u = coll('users')[p.uid];
    return u ? { uid: p.uid, email: u.email, name: u.name, photoURL: u.photoURL, emailVerified: true } : { ...VISITOR, uid: p.uid };
  };
  const fireAuth = () => authCb && authCb(signedIn ? personaUser() : null);
  const inRange = (d, from, to) => d && d >= from && d < to;

  const api = {
    mode: 'demo',
    personas: PERSONAS,
    get persona() { return persona; },
    setPersona(key) {
      persona = key;
      try { localStorage.setItem(PERSONA_KEY, key); } catch { /* ignore */ }
      setSignedIn(true);
      fireAuth();
    },
    reset() { db = buildSeed(); persist(); location.reload(); },

    onAuth(cb) { authCb = cb; setTimeout(fireAuth, 80); return () => { authCb = null; }; },
    async signIn() { await wait(300); setSignedIn(true); fireAuth(); },
    async signOut() { setSignedIn(false); fireAuth(); },

    async getMyInvite(email) { return one('invites', email.toLowerCase()); },
    async createMyProfile(au, form = {}, invite = null) {
      await wait();
      const base = { uid: au.uid, email: au.email, name: (form.name || au.name || au.email.split('@')[0]).slice(0, 80), photoURL: au.photoURL || null, pronouns: form.pronouns || '', major: form.major || '', bio: '', skills: [], links: {}, joinNote: form.joinNote || '', createdAt: new Date() };
      put('users', au.uid, invite ? { ...base, role: invite.role, status: 'active', subteams: invite.subteams || [], title: invite.title || '' } : { ...base, role: 'member', status: 'pending', subteams: form.subteams || [], title: '' });
      emit('users');
    },
    watchUser: (id, cb) => watch(['users'], () => one('users', id), cb),
    async updateMyProfile(id, p) { await wait(); patch('users', id, p); emit('users'); },
    async listMembers({ includeAll = false } = {}) { await wait(); return rows('users').filter((u) => includeAll || u.status === 'active'); },
    watchPendingMembers: (cb) => watch(['users'], () => rows('users').filter((u) => u.status === 'pending'), cb),
    async adminUpdateUser(id, p) { await wait(); patch('users', id, p); emit('users'); },
    async adminDeleteUser(id) { await wait(); delete coll('users')[id]; emit('users'); },
    async setSpaceAccess(changes) { await wait(); for (const [id, spaces] of Object.entries(changes)) patch('users', id, { spaces }); emit('users'); },
    async listInvites() { await wait(); return rows('invites'); },
    async saveInvite(inv, me) { await wait(); put('invites', inv.email.toLowerCase(), { email: inv.email.toLowerCase(), role: inv.role, subteams: inv.subteams || [], title: inv.title || '', invitedBy: me.uid, invitedByName: me.name, createdAt: new Date() }); emit('invites'); },
    async deleteInvite(email) { await wait(); delete coll('invites')[email.toLowerCase()]; emit('invites'); },

    watchSettings: (cb) => watch(['config'], () => one('config', 'settings'), cb),
    async saveSettings(data) { await wait(); patch('config', 'settings', data); emit('config'); },
    watchRefs: (cb) => watch(['subteams', 'activities', 'spaces', 'subsidiaries'], () => ({ subteams: rows('subteams'), activities: rows('activities'), spaces: rows('spaces'), subsidiaries: rows('subsidiaries') }), cb),
    async saveRef(n, item) { await wait(); const { id, ...data } = item; const key = id || uid(n.slice(0, 2)); patch(n, key, data); emit(n); return key; },
    async deleteRef(n, id) { await wait(); delete coll(n)[id]; emit(n); },
    async listSubteams() { await wait(60); return rows('subteams'); },
    async listSubsidiaries() { await wait(60); return rows('subsidiaries'); },
    async seedStarter(seed) { await wait(); for (const [n, items] of Object.entries(seed)) for (const [id, data] of Object.entries(items)) patch(n, id, data); emit(...Object.keys(seed)); },

    watchPresence: (cb) => watch(['presence'], () => rows('presence'), cb),
    async getEntry(id) { return one('timeEntries', id); },
    watchEntry: (id, cb) => watch(['timeEntries'], () => one('timeEntries', id), cb),
    async clockIn(d, me) {
      await wait(250);
      if (coll('presence')[me.uid]) throw Object.assign(new Error('Already clocked in'), { code: 'permission-denied' });
      const id = uid('te'), now = new Date();
      put('timeEntries', id, { uid: me.uid, name: me.name, start: now, end: null, status: 'open', source: 'clock', activityId: d.activityId || null, subteamId: d.subteamId || null, eventId: d.eventId || null, note: d.note || '', geo: d.geo || null, createdAt: now });
      put('presence', me.uid, { uid: me.uid, entryId: id, start: now, name: me.name, photoURL: me.photoURL || null, activityId: d.activityId || null, subteamId: d.subteamId || null });
      emit('timeEntries', 'presence');
      return id;
    },
    async clockOut(entry, me, { outNote = '' } = {}) {
      await wait(250);
      patch('timeEntries', entry.id, { end: new Date(), status: 'complete', outNote });
      delete coll('presence')[me.uid];
      emit('timeEntries', 'presence');
    },
    async requestFix(entry, me, { end, reason, outNote = '' }) {
      await wait(250);
      patch('timeEntries', entry.id, { end, status: 'pending', outNote, fix: { reason, requestedAt: new Date() } });
      delete coll('presence')[me.uid];
      emit('timeEntries', 'presence');
    },
    async listMyEntries(id, from, to) { await wait(); return rows('timeEntries').filter((e) => e.uid === id && inRange(e.start, from, to)).sort((a, b) => a.start - b.start); },
    async listEntries(from, to) { await wait(200); return rows('timeEntries').filter((e) => inRange(e.start, from, to)).sort((a, b) => a.start - b.start); },
    watchPendingFixes: (cb) => watch(['timeEntries'], () => rows('timeEntries').filter((e) => e.status === 'pending'), cb),
    async leadSaveEntry(entry, me, { clearPresenceOf } = {}) {
      await wait();
      const { id, ...data } = entry;
      const stamp = { editedBy: me.uid, editedAt: new Date() };
      let key = id;
      if (id) patch('timeEntries', id, { ...data, ...stamp });
      else { key = uid('te'); put('timeEntries', key, { ...data, source: 'lead', status: 'complete', geo: null, createdAt: new Date(), ...stamp }); }
      if (clearPresenceOf) delete coll('presence')[clearPresenceOf];
      emit('timeEntries', 'presence');
      return key;
    },
    async updateEntryDetails(id, p) { await wait(); patch('timeEntries', id, p); emit('timeEntries'); },
    async deleteEntry(id) { await wait(); delete coll('timeEntries')[id]; emit('timeEntries'); },

    async listEvents(from, to) { await wait(); return rows('events').filter((e) => inRange(e.start, from, to)).sort((a, b) => a.start - b.start); },
    async saveEvents(events, me) {
      await wait();
      const ids = events.map((ev) => {
        const { id, ...data } = ev; const key = id || uid('ev');
        if (id) patch('events', key, { ...data, updatedAt: new Date(), updatedBy: me.uid });
        else put('events', key, { ...data, createdBy: me.uid, createdAt: new Date(), updatedAt: new Date(), updatedBy: me.uid });
        return key;
      });
      emit('events');
      return ids;
    },
    async deleteEvent(id) { await wait(); delete coll('events')[id]; emit('events'); },
    watchAnnouncements: (cb) => watch(['announcements'], () => rows('announcements').sort((a, b) => b.createdAt - a.createdAt).slice(0, 40), cb),
    async saveAnnouncement(a, me) {
      await wait();
      const { id, ...data } = a;
      if (id) patch('announcements', id, { ...data, updatedAt: new Date() });
      else put('announcements', uid('an'), { ...data, authorUid: me.uid, authorName: me.name, authorPhoto: me.photoURL || null, createdAt: new Date(), updatedAt: new Date() });
      emit('announcements');
    },
    async deleteAnnouncement(id) { await wait(); delete coll('announcements')[id]; emit('announcements'); },

    watchSpaceContent: (spaceId, cb) => watch(['spaceContent'], () => one('spaceContent', spaceId), cb),
    async createSpace(meta, content = {}) {
      await wait();
      const id = uid('sp');
      put('spaces', id, { ...meta, updatedAt: new Date() });
      put('spaceContent', id, { tree: [], driveFolder: content.driveFolder || null, updatedAt: new Date() });
      emit('spaces', 'spaceContent');
      return id;
    },
    async saveSpaceContent(spaceId, p) { await wait(); patch('spaceContent', spaceId, { ...p, updatedAt: new Date() }); emit('spaceContent'); },

    watchPage: (id, cb) => watch(['pages'], () => one('pages', id), cb),
    async createPage(spaceId, { title, icon = '📄', parentId = null }, me) {
      await wait();
      const id = uid('pg');
      const sc = (coll('spaceContent')[spaceId] ||= { tree: [], driveFolder: null });
      const siblings = (sc.tree || []).filter((n) => (n.parentId || null) === parentId);
      const order = siblings.reduce((m, n) => Math.max(m, n.order || 0), 0) + 1;
      put('pages', id, { spaceId, parentId, title, icon, order, content: { blocks: [] }, rev: 1, createdBy: me.uid, createdByName: me.name, createdAt: new Date(), updatedBy: me.uid, updatedByName: me.name, updatedAt: new Date() });
      sc.tree = [...(sc.tree || []), { id, title, icon, parentId, order }];
      emit('pages', 'spaceContent');
      return id;
    },
    async savePageContent(page, content, me) {
      await wait(200);
      const cur = coll('pages')[page.id];
      if (!cur) throw Object.assign(new Error('Page deleted'), { code: 'not-found' });
      if ((cur.rev || 0) !== page.rev) throw Object.assign(new Error('Edited elsewhere'), { code: 'conflict', remote: one('pages', page.id) });
      const rev = (cur.rev || 0) + 1;
      patch('pages', page.id, { content, rev, updatedBy: me.uid, updatedByName: me.name, updatedAt: new Date() });
      emit('pages');
      return rev;
    },
    async updatePageMeta(page, p, me) {
      await wait();
      const cur = coll('pages')[page.id];
      const rev = (cur.rev || 0) + 1;
      patch('pages', page.id, { ...p, rev, updatedBy: me.uid, updatedByName: me.name, updatedAt: new Date() });
      const sc = coll('spaceContent')[page.spaceId];
      if (sc) sc.tree = (sc.tree || []).map((n) => (n.id === page.id ? { ...n, ...p } : n));
      emit('pages', 'spaceContent');
      return rev;
    },
    async deletePage(page) {
      await wait();
      const sc = coll('spaceContent')[page.spaceId] || { tree: [] };
      const doomed = descendants(sc.tree || [], page.id);
      doomed.forEach((id) => delete coll('pages')[id]);
      sc.tree = (sc.tree || []).filter((n) => !doomed.includes(n.id));
      emit('pages', 'spaceContent');
    },
    async deleteSpace(spaceId) {
      await wait();
      for (const [id, pg] of Object.entries(coll('pages'))) if (pg.spaceId === spaceId) delete coll('pages')[id];
      for (const [id, t] of Object.entries(coll('tasks'))) if (t.spaceId === spaceId) delete coll('tasks')[id];
      delete coll('spaceContent')[spaceId];
      delete coll('spaces')[spaceId];
      emit('pages', 'tasks', 'spaceContent', 'spaces');
    },
    async rebuildTree(spaceId) {
      await wait();
      const tree = rows('pages').filter((p) => p.spaceId === spaceId).map((p) => ({ id: p.id, title: p.title, icon: p.icon, parentId: p.parentId || null, order: p.order || 0 }));
      patch('spaceContent', spaceId, { tree });
      emit('spaceContent');
      return tree.length;
    },

    watchTasks: (spaceId, cb) => watch(['tasks'], () => rows('tasks').filter((t) => t.spaceId === spaceId), cb),
    async listMyTasks(id, spaceIds = []) { await wait(); return rows('tasks').filter((t) => (t.assignees || []).includes(id) && spaceIds.includes(t.spaceId)); },
    async saveTask(task, me) {
      await wait(120);
      const { id, ...data } = task;
      if (id) { patch('tasks', id, { ...data, updatedAt: new Date() }); emit('tasks'); return id; }
      const key = uid('tk');
      put('tasks', key, { ...data, createdBy: me.uid, createdAt: new Date(), updatedAt: new Date() });
      emit('tasks');
      return key;
    },
    async deleteTask(task) { await wait(); delete coll('tasks')[task.id]; emit('tasks'); },

    async log(me, action, summary, target = {}) { put('audit', uid('au'), { at: new Date(), actorUid: me.uid, actorName: me.name, action, summary, targetType: target.type || null, targetId: target.id || null }); persist(); },
    async listAudit() { await wait(); return rows('audit').sort((a, b) => b.at - a.at); },
  };
  return api;
}
