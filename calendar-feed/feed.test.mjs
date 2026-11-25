// Tests for the calendar feed (Code.gs) against a stand-in Firestore.
// Run: node --test calendar-feed/feed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const CODE = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');
const MINE = 'E'.repeat(32);       // picked Electrical
const ALL = 'A'.repeat(32);        // everything
const LEFT = 'L'.repeat(32);       // owner is no longer active
const UNKNOWN = 'U'.repeat(32);    // turned off, or never existed

const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  return { stringValue: String(v) };
};
const docOf = (path, data) => ({
  name: `projects/demo/databases/(default)/documents/${path}`,
  fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])),
});

function world() {
  const day = 864e5;
  const base = Math.floor(Date.now() / day) * day;
  const at = (d, h) => new Date(base + d * day + h * 3600e3);
  const db = {
    'users/u1': { name: 'Sam', status: 'active' },
    'users/u2': { name: 'Riley', status: 'inactive' },
    [`calendarFeeds/${MINE}`]: { uid: 'u1', subteams: ['cd-electrical'], everything: false },
    [`calendarFeeds/${ALL}`]: { uid: 'u1', subteams: [], everything: true },
    [`calendarFeeds/${LEFT}`]: { uid: 'u2', subteams: [], everything: true },
    'subsidiaries/crush': { name: 'Crush Depth' },
    'subteams/cd-electrical': { name: 'Electrical', subsidiaryId: 'crush' },
    'subteams/cd-chassis': { name: 'Chassis', subsidiaryId: 'crush' },
  };
  const events = [
    { id: 'general', title: 'General meeting', start: at(2, 18), end: at(2, 19), location: 'MS 101', type: 'meeting', subteams: [], updatedAt: at(-1, 0) },
    { id: 'elec', title: 'Tether wiring, part 2; bring gloves', start: at(3, 15), end: at(3, 17), description: 'Line one\nLine two, with a comma', type: 'build', subteams: ['cd-electrical'], updatedAt: at(-2, 0) },
    { id: 'chassis', title: 'Frame welding', start: at(4, 15), end: at(4, 17), location: 'Shop', type: 'build', subteams: ['cd-chassis'] },
    { id: 'both', title: 'Pool test 🌊 with a title long enough that it has to fold across more than one line of the feed', start: at(5, 9), end: at(5, 12), location: 'Aquatics center, lane 3', description: 'é'.repeat(120), type: 'pool', subteams: ['cd-electrical', 'cd-chassis'] },
    { id: 'old', title: 'Last spring’s kickoff', start: at(-200, 18), end: at(-200, 19), type: 'meeting', subteams: [] },
  ];
  let fetches = 0;
  const cache = new Map();
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'FIREBASE_PROJECT_ID' ? 'demo' : null) }) },
    ScriptApp: { getOAuthToken: () => 'token' },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => { cache.set(k, v); } }) },
    ContentService: { MimeType: { ICAL: 'text/calendar' }, createTextOutput: (text) => ({ text, setMimeType(m) { this.mime = m; return this; } }) },
    Logger: { log: () => {} },
    UrlFetchApp: {
      fetch(url, opts) {
        fetches++;
        assert.equal(opts.headers.Authorization, 'Bearer token');
        assert.equal(opts.headers['X-Goog-User-Project'], 'demo');
        const path = url.split('/documents')[1];
        const reply = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
        if (path === ':runQuery') {
          const since = JSON.parse(opts.payload).structuredQuery.where.fieldFilter.value.timestampValue;
          return reply(200, events.filter((e) => e.end.toISOString() >= since).map(({ id, ...data }) => ({ document: docOf(`events/${id}`, data) })));
        }
        const [p, qs] = path.slice(1).split('?');
        if (qs) return reply(200, { documents: Object.entries(db).filter(([k]) => k.startsWith(`${p}/`)).map(([k, v]) => docOf(k, v)) });
        return db[p] ? reply(200, docOf(p, db[p])) : reply(404, { error: { code: 404 } });
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return { get: (k) => ctx.doGet({ parameter: { k } }), fetches: () => fetches };
}

const unfold = (t) => t.replace(/\r\n /g, '');
const ids = (t) => [...unfold(t).matchAll(/^UID:(.+)@engineeringrenaissance\.org/gm)].map((m) => m[1]).sort();

test('a link shows club-wide events plus the subteams its owner picked', () => {
  const out = world().get(MINE);
  assert.equal(out.mime, 'text/calendar');
  assert.deepEqual(ids(out.text), ['both', 'elec', 'general']);
});

test('a link set to everything shows every event, but not ones from months ago', () => {
  assert.deepEqual(ids(world().get(ALL).text), ['both', 'chassis', 'elec', 'general']);
});

test('links of people who left, turned-off links and made-up links show an empty calendar that says so', () => {
  const w = world();
  for (const k of [LEFT, UNKNOWN, 'short', '', '../users/u1']) {
    const t = w.get(k).text;
    assert.ok(!t.includes('BEGIN:VEVENT'), k);
    assert.match(t, /X-WR-CALNAME:Engineering Renaissance \(link turned off\)/);
  }
  const before = w.fetches();
  w.get('not-a-real-link');
  assert.equal(w.fetches(), before, 'a malformed link never reaches the database');
});

test('it is valid iCalendar: CRLF lines of at most 75 bytes, escaped text, UTC times', () => {
  const t = world().get(MINE).text;
  assert.ok(t.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(t.endsWith('END:VCALENDAR\r\n'));
  for (const line of t.split('\r\n').slice(0, -1)) assert.ok(Buffer.byteLength(line) <= 75, `too long: ${line}`);
  const u = unfold(t);
  assert.match(u, /SUMMARY:Tether wiring\\, part 2\\; bring gloves\r\n/);
  assert.match(u, /DESCRIPTION:Line one\\nLine two\\, with a comma\\n\\nFor: Electrical \(Crush Depth\)\\n\\nIn the portal: https:\/\/engineeringrenaissance\.org\/portal\/#\/calendar\r\n/);
  assert.match(u, /SUMMARY:Pool test 🌊 with a title long enough that it has to fold across more than one line of the feed\r\n/);
  assert.match(u, /DESCRIPTION:é{120}/);
  assert.match(u, /LOCATION:Aquatics center\\, lane 3\r\n/);
  assert.match(u, /DTSTART:\d{8}T\d{6}Z\r\nDTEND:\d{8}T\d{6}Z\r\n/);
  assert.match(u, /CATEGORIES:Build day\r\n/);
  assert.match(u, /SEQUENCE:\d+\r\n/);
});

test('a finished feed is reused for a few minutes instead of reading the database again', () => {
  const w = world();
  w.get(MINE);
  const n = w.fetches();
  w.get(MINE);
  assert.equal(w.fetches(), n);
});
