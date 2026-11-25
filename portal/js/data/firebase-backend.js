// Production backend: Firebase Authentication (Google) + Cloud Firestore.
// Every write here is checked again by firebase/firestore.rules on Google's servers.
import * as fb from '../../vendor/firebase.js';
import { descendants } from './tree.js';

const {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, writeBatch, serverTimestamp, Timestamp, runTransaction,
} = fb;

function plain(v) {
  if (v instanceof Timestamp) return v.toDate();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object' && v.constructor === Object) {
    const o = {};
    for (const k of Object.keys(v)) o[k] = plain(v[k]);
    return o;
  }
  return v;
}
const fromSnap = (s) => ({ id: s.id, ...plain(s.data({ serverTimestamps: 'estimate' })) });
// Security rules allow 20 document lookups per batched write and each write here costs about 2,
// so multi-document writes go out in batches of 8.
const CHUNK = 8;
const list = (qs) => qs.docs.map(fromSnap);

export function createFirebaseBackend(config) {
  const app = fb.initializeApp(config.firebase);
  if (config.appCheckSiteKey) {
    try {
      fb.initializeAppCheck(app, { provider: new fb.ReCaptchaEnterpriseProvider(config.appCheckSiteKey), isTokenAutoRefreshEnabled: true });
    } catch (e) { console.warn('App Check not started', e); }
  }
  const auth = fb.getAuth(app);
  const db = fb.initializeFirestore(app, { localCache: fb.memoryLocalCache() });
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const col = (name) => collection(db, name);
  const ref = (name, id) => doc(db, name, id);
  const taskCol = (spaceId) => collection(db, 'spaces', spaceId, 'tasks');
  const watch = (q, cb, onErr, single = false) => onSnapshot(q,
    (s) => cb(single ? (s.exists() ? fromSnap(s) : null) : list(s)),
    (e) => { console.error(e); onErr && onErr(e); });

  const api = {
    mode: 'firebase',

    // ── Auth ──
    onAuth(cb) {
      return fb.onAuthStateChanged(auth, (u) => cb(u ? {
        uid: u.uid, email: u.email, name: u.displayName, photoURL: u.photoURL, emailVerified: u.emailVerified,
      } : null));
    },
    signIn: () => fb.signInWithPopup(auth, provider),
    signOut: () => fb.signOut(auth),

    // ── Profiles & members ──
    async getMyInvite(email) {
      try {
        const s = await getDoc(ref('invites', email.toLowerCase()));
        return s.exists() ? s.data() : null;
      } catch { return null; }
    },
    async createMyProfile(au, form = {}, invite = null) {
      const base = {
        uid: au.uid, email: au.email,
        name: String(form.name || au.name || au.email.split('@')[0]).trim().slice(0, 80),
        photoURL: au.photoURL || null,
        pronouns: form.pronouns || '', major: form.major || '', bio: '', skills: [], links: {},
        joinNote: form.joinNote || '', createdAt: serverTimestamp(),
      };
      const data = invite
        ? { ...base, role: invite.role, status: 'active', subteams: invite.subteams || [], title: invite.title || '' }
        : { ...base, role: 'member', status: 'pending', subteams: form.subteams || [], title: '' };
      await setDoc(ref('users', au.uid), data);
    },
    watchUser: (uid, cb, onErr) => watch(ref('users', uid), cb, onErr, true),
    updateMyProfile: (uid, patch) => updateDoc(ref('users', uid), patch),
    async listMembers({ includeAll = false } = {}) {
      const q = includeAll ? col('users') : query(col('users'), where('status', '==', 'active'));
      return list(await getDocs(q));
    },
    watchPendingMembers: (cb, onErr) => watch(query(col('users'), where('status', '==', 'pending')), cb, onErr),
    adminUpdateUser: (uid, patch) => updateDoc(ref('users', uid), patch),
    adminDeleteUser: (uid) => deleteDoc(ref('users', uid)),
    // Admins let people into private spaces: users/{uid}.spaces lists the ones they can open.
    async setSpaceAccess(changes) {
      const entries = Object.entries(changes); // [uid, spaces[]]
      for (let i = 0; i < entries.length; i += CHUNK) {
        const batch = writeBatch(db);
        entries.slice(i, i + CHUNK).forEach(([uid, spaces]) => batch.update(ref('users', uid), { spaces }));
        await batch.commit();
      }
    },
    async listInvites() { return list(await getDocs(col('invites'))); },
    saveInvite: (inv, me) => setDoc(ref('invites', inv.email.toLowerCase()), {
      email: inv.email.toLowerCase(), role: inv.role, subteams: inv.subteams || [], title: inv.title || '',
      invitedBy: me.uid, invitedByName: me.name, createdAt: serverTimestamp(),
    }),
    deleteInvite: (email) => deleteDoc(ref('invites', email.toLowerCase())),

    // ── Settings & reference data ──
    watchSettings: (cb, onErr) => watch(ref('config', 'settings'), cb, onErr, true),
    saveSettings: (data) => setDoc(ref('config', 'settings'), data, { merge: true }),
    watchRefs(cb, onErr) {
      const cur = { subteams: null, activities: null, spaces: null, subsidiaries: null };
      const emit = () => { if (Object.values(cur).every(Boolean)) cb({ ...cur }); };
      const u = Object.keys(cur).map((name) => watch(col(name), (rows) => { cur[name] = rows; emit(); }, onErr));
      return () => u.forEach((f) => f());
    },
    async saveRef(coll, item) {
      const { id, ...data } = item;
      if (id) { await setDoc(ref(coll, id), data, { merge: true }); return id; }
      const r = await addDoc(col(coll), data); return r.id;
    },
    deleteRef: (coll, id) => deleteDoc(ref(coll, id)),
    async listSubteams() { return list(await getDocs(col('subteams'))); },
    async listSubsidiaries() { return list(await getDocs(col('subsidiaries'))); },
    // First-run starter content, written with fixed ids so the join form's choices line up.
    async seedStarter(seed) {
      const writes = Object.entries(seed).flatMap(([coll, items]) => Object.entries(items).map(([id, data]) => [ref(coll, id), data]));
      for (let i = 0; i < writes.length; i += CHUNK) {
        const batch = writeBatch(db);
        writes.slice(i, i + CHUNK).forEach(([r, data]) => batch.set(r, data, { merge: true }));
        await batch.commit();
      }
    },

    // ── Time tracking ──
    watchPresence: (cb, onErr) => watch(col('presence'), cb, onErr),
    async getEntry(id) { const s = await getDoc(ref('timeEntries', id)); return s.exists() ? fromSnap(s) : null; },
    watchEntry: (id, cb, onErr) => watch(ref('timeEntries', id), cb, onErr, true),
    async clockIn(d, me) {
      const entryRef = doc(col('timeEntries'));
      const batch = writeBatch(db);
      batch.set(entryRef, {
        uid: me.uid, name: me.name, start: serverTimestamp(), end: null, status: 'open', source: 'clock',
        activityId: d.activityId || null, subteamId: d.subteamId || null, eventId: d.eventId || null,
        note: d.note || '', geo: d.geo || null, createdAt: serverTimestamp(),
      });
      batch.set(ref('presence', me.uid), {
        uid: me.uid, entryId: entryRef.id, start: serverTimestamp(), name: me.name, photoURL: me.photoURL ?? null,
        activityId: d.activityId || null, subteamId: d.subteamId || null,
      });
      await batch.commit();
      return entryRef.id;
    },
    // hasPresence: skip deleting presence/{uid} if a lead already cleared it (rules reject
    // deleting a document that doesn't exist).
    async clockOut(entry, me, { outNote = '', hasPresence = true } = {}) {
      const batch = writeBatch(db);
      batch.update(ref('timeEntries', entry.id), { end: serverTimestamp(), status: 'complete', outNote });
      if (hasPresence) batch.delete(ref('presence', me.uid));
      await batch.commit();
    },
    async requestFix(entry, me, { end, reason, outNote = '', hasPresence = true }) {
      const batch = writeBatch(db);
      batch.update(ref('timeEntries', entry.id), {
        end: Timestamp.fromDate(end), status: 'pending', outNote, fix: { reason, requestedAt: serverTimestamp() },
      });
      if (hasPresence) batch.delete(ref('presence', me.uid));
      await batch.commit();
    },
    async listMyEntries(uid, from, to) {
      const q = query(col('timeEntries'), where('uid', '==', uid), where('start', '>=', from), where('start', '<', to), orderBy('start', 'asc'));
      return list(await getDocs(q));
    },
    async listEntries(from, to) {
      const q = query(col('timeEntries'), where('start', '>=', from), where('start', '<', to), orderBy('start', 'asc'));
      return list(await getDocs(q));
    },
    watchPendingFixes: (cb, onErr) => watch(query(col('timeEntries'), where('status', '==', 'pending')), cb, onErr),
    // Leads add or correct sessions. Closing someone's open session also clears their presence.
    async leadSaveEntry(entry, me, { clearPresenceOf } = {}) {
      const { id, ...data } = entry;
      const stamp = { editedBy: me.uid, editedAt: serverTimestamp() };
      const batch = writeBatch(db);
      let entryRef;
      if (id) {
        entryRef = ref('timeEntries', id);
        batch.update(entryRef, { ...data, ...stamp });
      } else {
        entryRef = doc(col('timeEntries'));
        batch.set(entryRef, { ...data, source: 'lead', status: 'complete', geo: null, createdAt: serverTimestamp(), ...stamp });
      }
      if (clearPresenceOf) batch.delete(ref('presence', clearPresenceOf));
      await batch.commit();
      return entryRef.id;
    },
    updateEntryDetails: (id, patch) => updateDoc(ref('timeEntries', id), patch),
    deleteEntry: (id) => deleteDoc(ref('timeEntries', id)),

    // ── Events & announcements ──
    async listEvents(from, to) {
      const q = query(col('events'), where('start', '>=', from), where('start', '<', to), orderBy('start', 'asc'));
      return list(await getDocs(q));
    },
    async saveEvents(events, me) {
      const ids = [];
      for (let i = 0; i < events.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const ev of events.slice(i, i + CHUNK)) {
          const { id, ...data } = ev;
          const r = id ? ref('events', id) : doc(col('events'));
          ids.push(r.id);
          if (id) batch.set(r, { ...data, updatedAt: serverTimestamp(), updatedBy: me.uid }, { merge: true });
          else batch.set(r, { ...data, createdBy: me.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: me.uid });
        }
        await batch.commit();
      }
      return ids;
    },
    deleteEvent: (id) => deleteDoc(ref('events', id)),
    watchAnnouncements: (cb, onErr) => watch(query(col('announcements'), orderBy('createdAt', 'desc'), limit(40)), cb, onErr),
    async saveAnnouncement(a, me) {
      const { id, ...data } = a;
      if (id) return updateDoc(ref('announcements', id), { ...data, updatedAt: serverTimestamp() });
      return addDoc(col('announcements'), {
        ...data, authorUid: me.uid, authorName: me.name, authorPhoto: me.photoURL || null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
    },
    deleteAnnouncement: (id) => deleteDoc(ref('announcements', id)),

    // ── Spaces ──
    // spaces/{id} holds the name, group and who can open it; spaceContent/{id} holds the page
    // outline and Drive folder, which only people who can open the space may read.
    watchSpaceContent: (spaceId, cb, onErr) => watch(ref('spaceContent', spaceId), cb, onErr, true),
    async createSpace(meta, content = {}) {
      const r = doc(col('spaces'));
      const batch = writeBatch(db);
      batch.set(r, { ...meta, updatedAt: serverTimestamp() });
      batch.set(ref('spaceContent', r.id), { tree: [], driveFolder: content.driveFolder || null, updatedAt: serverTimestamp() });
      await batch.commit();
      return r.id;
    },
    saveSpaceContent: (spaceId, patch) => setDoc(ref('spaceContent', spaceId), { ...patch, updatedAt: serverTimestamp() }, { merge: true }),

    // ── Pages ──
    watchPage: (id, cb, onErr) => watch(ref('pages', id), cb, onErr, true),
    async createPage(spaceId, { title, icon = '📄', parentId = null }, me) {
      const pageRef = doc(col('pages'));
      await runTransaction(db, async (tx) => {
        const cs = await tx.get(ref('spaceContent', spaceId));
        const tree = (cs.data()?.tree || []).slice();
        const siblings = tree.filter((n) => (n.parentId || null) === parentId);
        const order = siblings.reduce((m, n) => Math.max(m, n.order || 0), 0) + 1;
        tree.push({ id: pageRef.id, title, icon, parentId, order });
        tx.set(pageRef, {
          spaceId, parentId, title, icon, order, content: { blocks: [] }, rev: 1,
          createdBy: me.uid, createdByName: me.name, createdAt: serverTimestamp(),
          updatedBy: me.uid, updatedByName: me.name, updatedAt: serverTimestamp(),
        });
        if (cs.exists()) tx.update(ref('spaceContent', spaceId), { tree, updatedAt: serverTimestamp() });
        else tx.set(ref('spaceContent', spaceId), { tree, driveFolder: null, updatedAt: serverTimestamp() });
      });
      return pageRef.id;
    },
    async savePageContent(page, content, me) {
      return runTransaction(db, async (tx) => {
        const s = await tx.get(ref('pages', page.id));
        if (!s.exists()) throw Object.assign(new Error('Page deleted'), { code: 'not-found' });
        const cur = s.data();
        if ((cur.rev || 0) !== page.rev) throw Object.assign(new Error('Edited elsewhere'), { code: 'conflict', remote: fromSnap(s) });
        const rev = (cur.rev || 0) + 1;
        tx.update(ref('pages', page.id), { content, rev, updatedBy: me.uid, updatedByName: me.name, updatedAt: serverTimestamp() });
        return rev;
      });
    },
    async updatePageMeta(page, patch, me) {
      return runTransaction(db, async (tx) => {
        const ps = await tx.get(ref('pages', page.id));
        const cs = await tx.get(ref('spaceContent', page.spaceId));
        const cur = ps.data();
        const rev = (cur.rev || 0) + 1;
        const tree = (cs.data()?.tree || []).map((n) => (n.id === page.id ? { ...n, ...pick(patch, ['title', 'icon', 'parentId', 'order']) } : n));
        tx.update(ref('pages', page.id), { ...patch, rev, updatedBy: me.uid, updatedByName: me.name, updatedAt: serverTimestamp() });
        if (cs.exists()) tx.update(ref('spaceContent', page.spaceId), { tree, updatedAt: serverTimestamp() });
        return rev;
      });
    },
    async deletePage(page) {
      const cs = await getDoc(ref('spaceContent', page.spaceId));
      const doomed = descendants(cs.data()?.tree || [], page.id);
      // Children first, in small batches; then take them all out of the outline.
      for (let i = doomed.length; i > 0; i -= CHUNK) {
        const batch = writeBatch(db);
        doomed.slice(Math.max(0, i - CHUNK), i).forEach((id) => batch.delete(ref('pages', id)));
        await batch.commit();
      }
      await runTransaction(db, async (tx) => {
        const cur = await tx.get(ref('spaceContent', page.spaceId));
        const tree = cur.data()?.tree || [];
        if (cur.exists()) tx.update(ref('spaceContent', page.spaceId), { tree: tree.filter((n) => !doomed.includes(n.id)), updatedAt: serverTimestamp() });
      });
    },
    // Deletes a space with its pages, tasks and outline (admins only). The space itself goes last,
    // because the rules for its tasks look it up.
    async deleteSpace(spaceId) {
      const [pages, tasks] = await Promise.all([
        getDocs(query(col('pages'), where('spaceId', '==', spaceId))),
        getDocs(taskCol(spaceId)),
      ]);
      const refs = [...pages.docs.map((d) => d.ref), ...tasks.docs.map((d) => d.ref), ref('spaceContent', spaceId), ref('spaces', spaceId)];
      for (let i = 0; i < refs.length; i += CHUNK) {
        const batch = writeBatch(db);
        refs.slice(i, i + CHUNK).forEach((r) => batch.delete(r));
        await batch.commit();
      }
    },
    async rebuildTree(spaceId) {
      const pages = list(await getDocs(query(col('pages'), where('spaceId', '==', spaceId))));
      const tree = pages.map((p) => ({ id: p.id, title: p.title, icon: p.icon || '📄', parentId: p.parentId || null, order: p.order || 0 }));
      await setDoc(ref('spaceContent', spaceId), { tree, updatedAt: serverTimestamp() }, { merge: true });
      return tree.length;
    },

    // ── Tasks: spaces/{spaceId}/tasks ──
    watchTasks: (spaceId, cb, onErr) => watch(taskCol(spaceId), cb, onErr),
    // One small query per space the person can open; the rules check each space by its path.
    async listMyTasks(uid, spaceIds = []) {
      const lists = await Promise.all(spaceIds.map((sid) => getDocs(query(taskCol(sid), where('assignees', 'array-contains', uid), limit(100)))
        .then(list).catch((e) => { console.warn('Tasks skipped for', sid, e); return []; })));
      return lists.flat();
    },
    async saveTask(task, me, { assigneeOnly = false } = {}) {
      const { id, spaceId, ...data } = task;
      if (!spaceId) throw new Error('A task needs its space.');
      if (id) {
        const patch = assigneeOnly ? pick(data, ['status', 'order', 'completedAt']) : data;
        return updateDoc(doc(db, 'spaces', spaceId, 'tasks', id), { ...patch, updatedAt: serverTimestamp() });
      }
      const r = await addDoc(taskCol(spaceId), { ...data, spaceId, createdBy: me.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      return r.id;
    },
    deleteTask: (task) => deleteDoc(doc(db, 'spaces', task.spaceId, 'tasks', task.id)),

    // ── Audit log (leads and admins) ──
    async log(me, action, summary, target = {}) {
      try {
        await addDoc(col('audit'), { at: serverTimestamp(), actorUid: me.uid, actorName: me.name, action, summary: String(summary).slice(0, 500), targetType: target.type || null, targetId: target.id || null });
      } catch (e) { console.warn('Audit log write skipped', e); }
    },
    async listAudit() { return list(await getDocs(query(col('audit'), orderBy('at', 'desc'), limit(200)))); },
  };
  return api;
}

function pick(o, keys) { const r = {}; for (const k of keys) if (k in o) r[k] = o[k]; return r; }
