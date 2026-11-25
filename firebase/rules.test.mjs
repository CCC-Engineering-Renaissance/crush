// Security rules tests. They run against the local Firestore emulator (needs Java 21+):
//
//   cd firebase && npm install && npm test
//
// GitHub runs them too whenever firebase/ changes (.github/workflows/portal-checks.yml).
//
// Each test signs in as a different kind of person and checks what the rules allow.
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, writeBatch, serverTimestamp, Timestamp,
} from 'firebase/firestore';

let env;
const HOUR = 3600e3;
const profile = (uid, role, status, extra = {}) => ({
  uid, email: `${uid}@example.com`, name: `${uid[0].toUpperCase()}${uid.slice(1)} Person`, photoURL: null, role, status,
  subteams: [], title: '', pronouns: '', major: '', bio: '', skills: [], links: {}, joinNote: '', createdAt: Timestamp.now(), ...extra,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-er-portal',
    firestore: { rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/admin'), profile('admin', 'admin', 'active', { title: 'President' }));
    await setDoc(doc(db, 'users/lead'), profile('lead', 'lead', 'active'));
    await setDoc(doc(db, 'users/lead2'), profile('lead2', 'lead', 'active'));
    await setDoc(doc(db, 'users/mem'), profile('mem', 'member', 'active'));
    await setDoc(doc(db, 'users/other'), profile('other', 'member', 'active'));
    await setDoc(doc(db, 'users/pend'), profile('pend', 'member', 'pending'));
    await setDoc(doc(db, 'config/settings'), { maxSessionHours: 10 });
    await setDoc(doc(db, 'spaces/open'), { name: 'Open', memberEdit: true });
    await setDoc(doc(db, 'spaces/locked'), { name: 'Locked', memberEdit: false });
    // A private space: "mem" was let in, "other" wasn't.
    await setDoc(doc(db, 'spaces/leads'), { name: 'tech-leads', memberEdit: true, private: true, subsidiaryId: 'crush' });
    await updateDoc(doc(db, 'users/mem'), { spaces: ['leads'] });
    for (const id of ['open', 'locked', 'leads']) await setDoc(doc(db, 'spaceContent', id), { tree: [{ id: 'p-' + id, title: 'Plans', icon: '📄', parentId: null, order: 1 }], driveFolder: null });
    await setDoc(doc(db, 'pages/secret'), { spaceId: 'leads', parentId: null, title: 'Plans', icon: '📄', order: 1, content: { blocks: [] }, rev: 1, createdBy: 'lead', createdByName: 'Lead Person', updatedBy: 'lead', updatedByName: 'Lead Person' });
    await setDoc(doc(db, 'spaces/leads/tasks/t9'), { spaceId: 'leads', title: 'Design review', description: '', status: 'todo', assignees: ['other'], due: null, priority: 'normal', labels: [], order: 1, createdBy: 'admin' });
    await setDoc(doc(db, 'subsidiaries/crush'), { name: 'Crush Depth', order: 1 });
    await setDoc(doc(db, 'invites/new.officer@example.com'), { email: 'new.officer@example.com', role: 'lead', subteams: ['media'], title: 'Media Lead' });
    // "other" forgot to clock out 12 hours ago.
    const start = Timestamp.fromMillis(Date.now() - 12 * HOUR);
    await setDoc(doc(db, 'timeEntries/stale'), { uid: 'other', name: 'Other Person', start, end: null, status: 'open', source: 'clock', activityId: null, subteamId: null, eventId: null, note: '', geo: null, createdAt: start });
    await setDoc(doc(db, 'presence/other'), { uid: 'other', entryId: 'stale', start, name: 'Other Person', photoURL: null, activityId: null, subteamId: null });
    // A fix request from lead (for separation-of-duties checks).
    const s2 = Timestamp.fromMillis(Date.now() - 30 * HOUR);
    await setDoc(doc(db, 'timeEntries/leadfix'), { uid: 'lead', name: 'Lead Person', start: s2, end: Timestamp.fromMillis(s2.toMillis() + 2 * HOUR), status: 'pending', source: 'clock', activityId: null, subteamId: null, eventId: null, note: '', geo: null, createdAt: s2, fix: { reason: 'Forgot', requestedAt: Timestamp.now() } });
  });
});

const as = (uid, email = `${uid}@example.com`) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();

function clockInBatch(db, uid, name, { start = serverTimestamp() } = {}) {
  const entry = doc(collection(db, 'timeEntries'));
  const b = writeBatch(db);
  b.set(entry, { uid, name, start, end: null, status: 'open', source: 'clock', activityId: null, subteamId: null, eventId: null, note: '', geo: null, createdAt: serverTimestamp() });
  b.set(doc(db, 'presence', uid), { uid, entryId: entry.id, start, name, photoURL: null, activityId: null, subteamId: null });
  return { b, entry };
}

// ── Joining ──
test('a new visitor can ask to join, but not make themselves active', async () => {
  const db = as('newbie');
  const base = { ...profile('newbie', 'member', 'pending'), createdAt: serverTimestamp() };
  await assertFails(setDoc(doc(db, 'users/newbie'), { ...base, status: 'active' }));
  await assertFails(setDoc(doc(db, 'users/newbie'), { ...base, role: 'admin' }));
  await assertSucceeds(setDoc(doc(db, 'users/newbie'), base));
});

test('an invited person gets exactly the invited role', async () => {
  const db = as('officer', 'new.officer@example.com');
  const base = { ...profile('officer', 'lead', 'active', { email: 'new.officer@example.com', subteams: ['media'], title: 'Media Lead' }), createdAt: serverTimestamp() };
  await assertFails(setDoc(doc(db, 'users/officer'), { ...base, role: 'admin' }));
  await assertSucceeds(setDoc(doc(db, 'users/officer'), base));
});

test('pending applicants see only their own profile', async () => {
  const db = as('pend');
  await assertSucceeds(getDoc(doc(db, 'users/pend')));
  await assertFails(getDoc(doc(db, 'users/mem')));
  await assertFails(getDocs(collection(db, 'presence')));
});

test('members cannot promote themselves', async () => {
  const db = as('mem');
  await assertFails(updateDoc(doc(db, 'users/mem'), { role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'users/mem'), { status: 'inactive' }));
  await assertSucceeds(updateDoc(doc(db, 'users/mem'), { bio: 'I build thrusters' }));
});

test('members list only active profiles; admins can approve applicants', async () => {
  await assertFails(getDocs(collection(as('mem'), 'users')));
  await assertSucceeds(getDocs(query(collection(as('mem'), 'users'), where('status', '==', 'active'))));
  await assertSucceeds(updateDoc(doc(as('admin'), 'users/pend'), { status: 'active' }));
  await assertFails(updateDoc(doc(as('lead'), 'users/mem'), { role: 'lead' }));
});

// ── Clocking in and out ──
test('clock in uses the server clock and only once at a time', async () => {
  const db = as('mem');
  await assertFails(clockInBatch(db, 'mem', 'Mem Person', { start: Timestamp.fromMillis(Date.now() - 5 * HOUR) }).b.commit());
  await assertSucceeds(clockInBatch(db, 'mem', 'Mem Person').b.commit());
  await assertFails(clockInBatch(db, 'mem', 'Mem Person').b.commit());
});

test('nobody can clock in as someone else or under another name', async () => {
  await assertFails(clockInBatch(as('mem'), 'other2', 'Mem Person').b.commit());
  await assertFails(clockInBatch(as('mem'), 'mem', 'Admin Person').b.commit());
  await assertFails(clockInBatch(as('pend'), 'pend', 'Pend Person').b.commit());
});

test('clock out closes the session and clears presence together', async () => {
  const db = as('mem');
  const { b, entry } = clockInBatch(db, 'mem', 'Mem Person');
  await b.commit();
  await assertFails(updateDoc(entry, { end: serverTimestamp(), status: 'complete', outNote: '' })); // presence left behind
  const out = writeBatch(db);
  out.update(entry, { end: serverTimestamp(), status: 'complete', outNote: 'done' });
  out.delete(doc(db, 'presence/mem'));
  await assertSucceeds(out.commit());
});

test('a session past the limit needs a fix request, not a normal clock-out', async () => {
  const db = as('other');
  const late = writeBatch(db);
  late.update(doc(db, 'timeEntries/stale'), { end: serverTimestamp(), status: 'complete', outNote: '' });
  late.delete(doc(db, 'presence/other'));
  await assertFails(late.commit());
  const fix = writeBatch(db);
  fix.update(doc(db, 'timeEntries/stale'), {
    end: Timestamp.fromMillis(Date.now() - 9 * HOUR), status: 'pending', outNote: '', fix: { reason: 'Forgot to clock out', requestedAt: serverTimestamp() },
  });
  fix.delete(doc(db, 'presence/other'));
  await assertSucceeds(fix.commit());
});

test('members read only their own sessions; leads read everyone’s', async () => {
  await assertFails(getDoc(doc(as('mem'), 'timeEntries/stale')));
  await assertSucceeds(getDoc(doc(as('other'), 'timeEntries/stale')));
  await assertSucceeds(getDocs(query(collection(as('lead'), 'timeEntries'), where('status', '==', 'pending'))));
  await assertFails(getDocs(query(collection(as('mem'), 'timeEntries'), where('status', '==', 'pending'))));
});

test('leads approve other people’s fixes but not their own; admins can', async () => {
  const lead = as('lead');
  await assertFails(updateDoc(doc(lead, 'timeEntries/leadfix'), { status: 'complete', editedBy: 'lead', editedAt: serverTimestamp() }));
  const lead2 = as('lead2');
  await assertSucceeds(updateDoc(doc(lead2, 'timeEntries/leadfix'), { status: 'complete', editedBy: 'lead2', editedAt: serverTimestamp() }));
});

test('only leads add sessions for others, and edits are stamped', async () => {
  const entry = { uid: 'mem', name: 'Mem Person', start: Timestamp.fromMillis(Date.now() - 3 * HOUR), end: Timestamp.fromMillis(Date.now() - HOUR), status: 'complete', source: 'lead', activityId: null, subteamId: null, eventId: null, note: '', outNote: '', geo: null, createdAt: serverTimestamp(), reviewNote: '' };
  await assertFails(addDoc(collection(as('mem'), 'timeEntries'), { ...entry, editedBy: 'mem', editedAt: serverTimestamp() }));
  await assertFails(addDoc(collection(as('lead'), 'timeEntries'), { ...entry, editedBy: 'someone-else', editedAt: serverTimestamp() }));
  await assertSucceeds(addDoc(collection(as('lead'), 'timeEntries'), { ...entry, editedBy: 'lead', editedAt: serverTimestamp() }));
});

test('members can’t delete sessions; admins can', async () => {
  await assertFails(deleteDoc(doc(as('other'), 'timeEntries/stale')));
  await assertSucceeds(deleteDoc(doc(as('admin'), 'timeEntries/stale')));
});

// ── Pages and tasks ──
const nameOf = (uid) => `${uid[0].toUpperCase()}${uid.slice(1)} Person`;
const page = (spaceId, uid) => ({ spaceId, parentId: null, title: 'Notes', icon: '📄', order: 1, content: { blocks: [] }, rev: 1, createdBy: uid, createdByName: nameOf(uid), createdAt: serverTimestamp(), updatedBy: uid, updatedByName: nameOf(uid), updatedAt: serverTimestamp() });

test('members edit pages in open spaces only', async () => {
  await assertSucceeds(setDoc(doc(as('mem'), 'pages/p1'), page('open', 'mem')));
  await assertFails(setDoc(doc(as('mem'), 'pages/p2'), page('locked', 'mem')));
  await assertSucceeds(setDoc(doc(as('lead'), 'pages/p3'), page('locked', 'lead')));
  await assertFails(updateDoc(doc(as('mem'), 'pages/p3'), { title: 'Mine now', rev: 2, updatedBy: 'mem', updatedByName: nameOf('mem') }));
});

test('page saves must bump the revision (no silent overwrites)', async () => {
  await assertSucceeds(setDoc(doc(as('mem'), 'pages/p1'), page('open', 'mem')));
  await assertFails(updateDoc(doc(as('other'), 'pages/p1'), { content: { blocks: [] }, rev: 1, updatedBy: 'other', updatedByName: nameOf('other') }));
  await assertFails(updateDoc(doc(as('other'), 'pages/p1'), { content: { blocks: [] }, rev: 2, updatedBy: 'other', updatedByName: 'Someone Else' }));
  await assertSucceeds(updateDoc(doc(as('other'), 'pages/p1'), { content: { blocks: [] }, rev: 2, updatedBy: 'other', updatedByName: nameOf('other') }));
});

test('people on a task can move it; others in a locked space can’t', async () => {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'spaces/locked/tasks/t1'), { spaceId: 'locked', title: 'Tap holes', description: '', status: 'todo', assignees: ['mem'], due: null, priority: 'normal', labels: [], order: 1, createdBy: 'lead' }));
  await assertSucceeds(updateDoc(doc(as('mem'), 'spaces/locked/tasks/t1'), { status: 'doing', order: 2 }));
  await assertFails(updateDoc(doc(as('mem'), 'spaces/locked/tasks/t1'), { title: 'Renamed' }));
  await assertFails(updateDoc(doc(as('other'), 'spaces/locked/tasks/t1'), { status: 'done' }));
  const task = { spaceId: 'open', title: 'Print jaws', description: '', status: 'todo', assignees: [], due: null, priority: 'normal', labels: [], order: 1 };
  await assertSucceeds(addDoc(collection(as('mem'), 'spaces/open/tasks'), { ...task, createdBy: 'mem' }));
  // The task's spaceId has to match the board it's on.
  await assertFails(addDoc(collection(as('mem'), 'spaces/open/tasks'), { ...task, spaceId: 'locked', createdBy: 'mem' }));
});

// ── Private spaces ──
test('private spaces: only people let in read the outline, pages and tasks', async () => {
  // Every active member can list spaces (names only), so the sidebar knows what exists.
  await assertSucceeds(getDocs(collection(as('other'), 'spaces')));
  await assertFails(getDocs(collection(as('pend'), 'spaces')));
  // Outline
  await assertSucceeds(getDoc(doc(as('mem'), 'spaceContent/leads')));
  await assertSucceeds(getDoc(doc(as('admin'), 'spaceContent/leads')));
  await assertFails(getDoc(doc(as('other'), 'spaceContent/leads')));
  await assertFails(getDoc(doc(as('lead'), 'spaceContent/leads')));   // leads aren't let in automatically
  await assertSucceeds(getDoc(doc(as('other'), 'spaceContent/open')));
  // Pages
  await assertSucceeds(getDoc(doc(as('mem'), 'pages/secret')));
  await assertFails(getDoc(doc(as('other'), 'pages/secret')));
  await assertFails(setDoc(doc(as('other'), 'pages/p5'), page('leads', 'other')));
  await assertSucceeds(setDoc(doc(as('mem'), 'pages/p5'), page('leads', 'mem')));
  await assertFails(deleteDoc(doc(as('lead'), 'pages/secret')));
  // Tasks: being assigned isn't enough to see a private board.
  await assertSucceeds(getDocs(collection(as('mem'), 'spaces/leads/tasks')));
  await assertFails(getDocs(collection(as('other'), 'spaces/leads/tasks')));
  await assertFails(getDocs(query(collection(as('other'), 'spaces/leads/tasks'), where('assignees', 'array-contains', 'other'))));
  await assertSucceeds(getDocs(query(collection(as('mem'), 'spaces/open/tasks'), where('assignees', 'array-contains', 'mem'))));
});

test('members can’t let themselves into a private space', async () => {
  await assertFails(updateDoc(doc(as('other'), 'users/other'), { spaces: ['leads'] }));
  await assertFails(setDoc(doc(as('pend'), 'users/pend'), { spaces: ['leads'] }, { merge: true }));
  await assertFails(updateDoc(doc(as('lead'), 'users/other'), { spaces: ['leads'] }));
  await assertSucceeds(updateDoc(doc(as('admin'), 'users/other'), { spaces: ['leads'] }));
  await assertSucceeds(getDoc(doc(as('other'), 'spaceContent/leads')));
  // A new visitor can't sign up already inside one either.
  await assertFails(setDoc(doc(as('newbie', 'newbie@example.com'), 'users/newbie'), { ...profile('newbie', 'member', 'pending'), createdAt: serverTimestamp(), spaces: ['leads'] }));
});

test('leads rename spaces they can open; only admins change who can open them', async () => {
  await assertSucceeds(updateDoc(doc(as('lead'), 'spaces/open'), { name: 'general', description: 'Everything else' }));
  await assertFails(updateDoc(doc(as('lead'), 'spaces/open'), { private: true }));
  await assertFails(updateDoc(doc(as('lead'), 'spaces/leads'), { name: 'renamed' }));   // not let in
  await assertFails(updateDoc(doc(as('mem'), 'spaces/leads'), { private: false }));
  await assertSucceeds(updateDoc(doc(as('admin'), 'spaces/leads'), { private: false }));
  await assertSucceeds(getDoc(doc(as('other'), 'spaceContent/leads')));
});

test('space icons: leads set an emoji or a small picture, never a link or anything big', async () => {
  const png = 'data:image/png;base64,' + 'iVBORw0KGgo'.padEnd(800, 'A') + '==';
  await assertSucceeds(updateDoc(doc(as('lead'), 'spaces/open'), { icon: '🦾', iconImage: null }));
  await assertSucceeds(updateDoc(doc(as('lead'), 'spaces/open'), { icon: '', iconImage: png }));
  await assertFails(updateDoc(doc(as('lead'), 'spaces/open'), { iconImage: 'https://example.com/tracker.png' }));
  await assertFails(updateDoc(doc(as('lead'), 'spaces/open'), { iconImage: 'data:image/svg+xml;base64,PHN2Zz4=' }));
  await assertFails(updateDoc(doc(as('admin'), 'spaces/open'), { iconImage: 'data:image/png;base64,' + 'A'.repeat(60000) }));
  await assertFails(updateDoc(doc(as('lead'), 'spaces/open'), { icon: 'x'.repeat(70) }));
  await assertFails(updateDoc(doc(as('mem'), 'spaces/open'), { icon: '🐙' }));
  await assertFails(updateDoc(doc(as('lead'), 'spaces/leads'), { icon: '🐙' }));   // not let in
  await assertSucceeds(setDoc(doc(as('admin'), 'spaces/new'), { name: 'new', icon: '🛟', iconImage: png, memberEdit: true }));
});

test('outlines: editors change the page list, leads also link the Drive folder', async () => {
  const tree = [{ id: 'x', title: 'New', icon: '📄', parentId: null, order: 1 }];
  await assertSucceeds(updateDoc(doc(as('other'), 'spaceContent/open'), { tree }));
  await assertFails(updateDoc(doc(as('other'), 'spaceContent/open'), { driveFolder: { id: 'f', name: 'Files', url: '' } }));
  await assertSucceeds(updateDoc(doc(as('lead'), 'spaceContent/open'), { driveFolder: { id: 'f', name: 'Files', url: '' } }));
  await assertFails(updateDoc(doc(as('other'), 'spaceContent/locked'), { tree }));
  await assertFails(updateDoc(doc(as('other'), 'spaceContent/open'), { secret: 'x' }));
  // An admin creates a space and its outline in one batch.
  const db = as('admin');
  const b = writeBatch(db);
  b.set(doc(db, 'spaces/new'), { name: 'float', memberEdit: true, private: false });
  b.set(doc(db, 'spaceContent/new'), { tree: [], driveFolder: null });
  await assertSucceeds(b.commit());
});

test('subsidiaries: everyone signed in reads them, only admins write', async () => {
  await assertSucceeds(getDoc(doc(as('pend'), 'subsidiaries/crush')));
  await assertFails(setDoc(doc(as('lead'), 'subsidiaries/prosthetic'), { name: 'Prosthetic', order: 2 }));
  await assertSucceeds(setDoc(doc(as('admin'), 'subsidiaries/prosthetic'), { name: 'Prosthetic', order: 2 }));
});

// ── Club content and audit ──
test('only leads post announcements and events', async () => {
  await assertFails(addDoc(collection(as('mem'), 'announcements'), { title: 'Hi', body: '', authorUid: 'mem', authorName: nameOf('mem') }));
  await assertSucceeds(addDoc(collection(as('lead'), 'announcements'), { title: 'Hi', body: '', authorUid: 'lead', authorName: nameOf('lead') }));
  const ev = { title: 'Meeting', start: Timestamp.now(), end: Timestamp.fromMillis(Date.now() + HOUR) };
  await assertFails(addDoc(collection(as('mem'), 'events'), ev));
  await assertSucceeds(addDoc(collection(as('lead'), 'events'), ev));
});

test('the audit log is append-only and admin-readable', async () => {
  await assertFails(addDoc(collection(as('mem'), 'audit'), { actorUid: 'mem', actorName: nameOf('mem'), at: serverTimestamp(), summary: 'x' }));
  const ref = await assertSucceeds(addDoc(collection(as('lead'), 'audit'), { actorUid: 'lead', actorName: nameOf('lead'), at: serverTimestamp(), summary: 'Approved a session' }));
  await assertFails(getDocs(collection(as('lead'), 'audit')));
  await assertSucceeds(getDocs(collection(as('admin'), 'audit')));
  await assertFails(deleteDoc(doc(as('admin'), 'audit', ref.id)));
});

test('settings: members read, only admins write', async () => {
  await assertSucceeds(getDoc(doc(as('mem'), 'config/settings')));
  await assertFails(setDoc(doc(as('lead'), 'config/settings'), { maxSessionHours: 99 }));
  await assertSucceeds(setDoc(doc(as('admin'), 'config/settings'), { maxSessionHours: 12 }, { merge: true }));
});
