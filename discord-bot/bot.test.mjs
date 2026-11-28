// Tests for the Discord announcements bot (Code.gs), run in Node with a pretend Discord server,
// a pretend Firestore and stand-ins for the Apps Script services. No network, no accounts.
//
//   node --test discord-bot/bot.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('./Code.gs', import.meta.url), 'utf8');

// Snowflake ids that encode "now", so the bot's two-week window keeps them.
let seq = 0;
const snow = () => String(((BigInt(Date.now()) - 1420070400000n) << 22n) + BigInt(++seq));

// Discord ids are numbers. Tests write them by name (BOT, R_CHASSIS, C1…) and x() swaps in the number.
const N = {
  BOT: '1001', OWNER: '1999', G: '2001', U_LEAD: '3001', U_MEM: '3002',
  R_OFFICER: '4001', R_ADMIN: '4002', R_CHASSIS: '4003', R_FLOAT: '4004', R_ELEC: '4005', R_MATE: '4006', R_BOT: '4007',
  C1: '5001', C2: '5002', C3: '5003', CAT: '5009',
};
const x = (str) => str.replace(/\b(BOT|OWNER|G|U_LEAD|U_MEM|R_[A-Z]+|C[1-3]|CAT)\b/g, (k) => N[k]);

let world;
function newWorld() {
  const val = (v) => (v === null || v === undefined ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() }
    : Array.isArray(v) ? { arrayValue: { values: v.map(val) } } : typeof v === 'boolean' ? { booleanValue: v }
    : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) });
  const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));
  const w = {
    roles: [
      { id: N.G, name: '@everyone', permissions: '0' },
      { id: N.R_OFFICER, name: 'Officer', permissions: String(1 << 17) },          // can @everyone
      { id: N.R_ADMIN, name: 'Admin', permissions: '2251799813685247' },             // every bit
      { id: N.R_CHASSIS, name: 'Chassis', permissions: '0' },
      { id: N.R_FLOAT, name: 'Float', permissions: '0' },
      { id: N.R_ELEC, name: 'Electrical', permissions: '0' },
      { id: N.R_MATE, name: 'MATE', permissions: '0' },
      { id: N.R_BOT, name: 'ER Portal', managed: true, tags: { bot_id: N.BOT }, permissions: '0' },
    ],
    members: {
      [N.U_LEAD]: { user: { id: N.U_LEAD, username: 'priya', global_name: 'Priya' }, nick: 'Priya N.', roles: [N.R_OFFICER], avatar: null },
      [N.U_MEM]: { user: { id: N.U_MEM, username: 'sofia', global_name: 'Sofia', avatar: 'abc' }, nick: null, roles: [N.R_CHASSIS] },
    },
    channels: [
      { id: N.C1, type: 0, name: 'chassis', messages: [] },
      { id: N.C2, type: 0, name: 'mate-club-mgmt', messages: [] },
      { id: N.CAT, type: 4, name: 'MATE' },
    ],
    docs: {
      subteams: {
        'cd-chassis': { name: 'Chassis', subsidiaryId: 'crush', discordRole: '' },
        'cd-float': { name: 'Float', subsidiaryId: 'crush', discordRole: '' },
        'cd-electrical': { name: 'Electrical', subsidiaryId: 'crush', discordRole: '' },
        'pr-electrical': { name: 'Electrical', subsidiaryId: 'prosthetic', discordRole: '' },
        'old': { name: 'Old', subsidiaryId: null, discordRole: 'Chassis', archived: true },
      },
      subsidiaries: { crush: { name: 'Crush Depth', discordRole: 'MATE' }, prosthetic: { name: 'Prosthetic', discordRole: '' } },
      // Portal members: Sofia and Priya have their Discord usernames on their profiles, Max doesn't.
      users: {
        'u-sofia': { name: 'Sofia', status: 'active', discord: '@Sofia' },
        'u-priya': { name: 'Priya', status: 'active', discord: 'priya' },
        'u-max': { name: 'Max', status: 'active' },
      },
      presence: {},
      spaces: {},
    },
    tasks: [],        // spaces/{spaceId}/tasks/{id}, as { id, spaceId, ...fields }
    settings: null,   // config/settings
    dms: [],
    dmBlocked: [],    // Discord users whose settings block DMs from the server
    announcements: {},
    audit: [],
    reactions: [],
    replies: [],
    calls: [],
    rateLimitMessages: false,
    props: { DISCORD_BOT_TOKEN: 'token', FIREBASE_PROJECT_ID: 'er-test' },
    cache: {},
    triggers: [],
  };
  w.fields = fields;
  w.fsDocs = (coll) => ({ documents: Object.entries(w.docs[coll]).map(([id, d]) => ({ name: `projects/er-test/databases/(default)/documents/${coll}/${id}`, fields: fields(d) })) });
  return w;
}

const res = (code, body) => ({ getResponseCode: () => code, getContentText: () => (body === undefined ? '' : JSON.stringify(body)) });

function handle(url, req) {
  const method = (req.method || 'get').toLowerCase();
  world.calls.push(`${method} ${url}`);
  const u = new URL(url);
  if (u.host === 'discord.com') {
    assert.equal(req.headers.Authorization, 'Bot token');
    const path = u.pathname.replace('/api/v10', '');
    if (path === '/users/@me') return res(200, { id: N.BOT, username: 'ER Portal' });
    if (path === '/users/@me/guilds') return res(200, [{ id: N.G, name: 'Engineering Renaissance' }]);
    if (path === x('/guilds/G')) return res(200, { id: N.G, name: 'Engineering Renaissance', owner_id: N.OWNER });
    if (path === x('/guilds/G/roles')) return res(200, world.roles);
    if (path === x('/guilds/G/channels')) {
      return res(200, world.channels.map(({ messages, ...c }) => ({ ...c, last_message_id: messages?.length ? messages[messages.length - 1].id : null })));
    }
    if (path === x('/guilds/G/members/search')) {
      const q = u.searchParams.get('query').toLowerCase();
      return res(200, Object.values(world.members).filter((mb) => [mb.user.username, mb.user.global_name, mb.nick].some((n) => n && n.toLowerCase().startsWith(q))));
    }
    if (path === '/users/@me/channels' && method === 'post') return res(200, { id: '8' + JSON.parse(req.payload).recipient_id, type: 1 });
    let m = path.match(new RegExp(`^/guilds/${N.G}/members/(\\d+)$`));
    if (m) return world.members[m[1]] ? res(200, world.members[m[1]]) : res(404, { message: 'Unknown Member' });
    m = path.match(/^\/channels\/(\d+)\/messages$/);
    if (m && method === 'get') {
      if (world.rateLimitMessages) return res(429, { retry_after: 30 });
      const ch = world.channels.find((c) => c.id === m[1]);
      const after = u.searchParams.get('after');
      const limit = Number(u.searchParams.get('limit') || 50);
      let list = ch.messages.slice();
      if (after) list = list.filter((x) => BigInt(x.id) > BigInt(after)).slice(0, limit);
      else list = list.slice(-limit);
      return res(200, list.slice().reverse()); // newest first, like Discord
    }
    if (m && method === 'post' && m[1].startsWith('8')) { // a DM channel: '8' + the user's id
      const to = m[1].slice(1);
      if (world.dmBlocked.includes(to)) return res(403, { message: 'Cannot send messages to this user', code: 50007 });
      world.dms.push({ to, ...JSON.parse(req.payload) });
      return res(200, { id: snow() });
    }
    if (m && method === 'post') { world.replies.push({ channel: m[1], ...JSON.parse(req.payload) }); return res(200, { id: snow() }); }
    m = path.match(/^\/channels\/(\d+)\/messages\/(\d+)\/reactions\/([^/]+)\/@me$/);
    if (m && method === 'put') { world.reactions.push({ message: m[2], emoji: decodeURIComponent(m[3]) }); return res(204); }
    throw new Error('Unexpected Discord call ' + method + ' ' + path);
  }
  if (u.host === 'firestore.googleapis.com') {
    assert.equal(req.headers['X-Goog-User-Project'], 'er-test');
    assert.equal(req.headers.Authorization, 'Bearer oauth-token');
    const path = decodeURIComponent(u.pathname).replace('/v1/projects/er-test/databases/(default)/documents/', '');
    const [coll, id] = path.split('/');
    if (path.endsWith('documents:runQuery') && method === 'post') {
      assert.deepEqual(JSON.parse(req.payload).structuredQuery.from, [{ collectionId: 'tasks', allDescendants: true }]);
      return res(200, [...world.tasks.map(({ id: tid, spaceId, ...t }) => ({ document: { name: `projects/er-test/databases/(default)/documents/spaces/${spaceId}/tasks/${tid}`, fields: world.fields({ spaceId, ...t }) } })), { readTime: new Date().toISOString() }]);
    }
    if (coll === 'config' && id === 'settings' && method === 'get') {
      return world.settings ? res(200, { name: path, fields: world.fields(world.settings) }) : res(404, { error: { status: 'NOT_FOUND' } });
    }
    if (method === 'get' && world.docs[coll]) return res(200, world.fsDocs(coll));
    if (coll === 'announcements' && method === 'patch') {
      const mask = u.searchParams.getAll('updateMask.fieldPaths');
      const body = JSON.parse(req.payload).fields;
      const prev = world.announcements[id] || {};
      for (const f of mask) { if (f in body) prev[f] = body[f]; else delete prev[f]; }
      world.announcements[id] = prev;
      return res(200, { name: path, fields: prev });
    }
    if (coll === 'announcements' && method === 'delete') { delete world.announcements[id]; return res(200, {}); }
    if (coll === 'audit' && method === 'post') { world.audit.push(JSON.parse(req.payload).fields); return res(200, {}); }
    throw new Error('Unexpected Firestore call ' + method + ' ' + path);
  }
  throw new Error('Unexpected host ' + u.host);
}

function load() {
  const sandbox = {
    console: { log() {}, warn() {}, error: console.error },
    UrlFetchApp: {
      fetch: (url, req) => handle(url, req),
      fetchAll: (reqs) => reqs.map((r) => handle(r.url, r)),
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in world.props ? world.props[k] : null),
      setProperty: (k, v) => { world.props[k] = String(v); },
      getProperties: () => ({ ...world.props }),
      deleteProperty: (k) => { delete world.props[k]; },
    }) },
    CacheService: { getScriptCache: () => ({ get: (k) => world.cache[k] ?? null, put: (k, v) => { world.cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: {
      getOAuthToken: () => 'oauth-token',
      getProjectTriggers: () => world.triggers,
      deleteTrigger: (t) => { world.triggers = world.triggers.filter((x) => x !== t); },
      newTrigger: (fn) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => { world.triggers.push({ getHandlerFunction: () => fn, n }); } }) }) }),
    },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 16).replace('T', ' '), sleep() {} },
    URL, Date, JSON, Math, Number, String, Object, Array, RegExp, Error, encodeURIComponent, decodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox;
}

let bot;
const mentionsIn = (content) => [...content.matchAll(/<@!?(\d+)>/g)].map((r) => ({ id: r[1], username: 'user' + r[1], global_name: r[1] === N.U_MEM ? 'Sofia' : null }));
const rolesIn = (content) => [...content.matchAll(/<@&(\d+)>/g)].map((r) => r[1]);
const post = (channel, author, text, extra = {}) => {
  const ch = world.channels.find((c) => c.id === N[channel]);
  const content = x(text);
  const m = {
    id: snow(), type: 0, channel_id: ch.id, content, timestamp: new Date().toISOString(), edited_timestamp: null,
    author: { ...(world.members[N[author]]?.user || { id: N[author], username: author }), bot: false },
    mentions: mentionsIn(content), mention_roles: rolesIn(content), mention_everyone: /@everyone/.test(content), attachments: [], ...extra,
  };
  ch.messages.push(m);
  return m;
};
const edit = (m, text) => {
  m.content = x(text);
  m.mentions = mentionsIn(m.content);
  m.mention_roles = rolesIn(m.content);
  m.edited_timestamp = new Date(Date.now() + 1000 * (++seq)).toISOString();
};
const doc = (m) => world.announcements['discord-' + m.id];
const str = (f) => f?.stringValue;
const arr = (f) => (f?.arrayValue?.values || []).map((v) => v.stringValue);

beforeEach(() => {
  world = newWorld();
  bot = load();
});

test('setup checks everything and starts the one-minute check; older posts are left alone', () => {
  post('C1', 'U_LEAD', '<@BOT> <@&R_CHASSIS> posted before setup');
  bot.setup();
  assert.equal(world.triggers.length, 1);
  assert.equal(world.triggers[0].getHandlerFunction(), 'poll');
  assert.equal(world.triggers[0].n, 1);
  bot.setup(); // running it again doesn't add a second trigger
  assert.equal(world.triggers.length, 1);
  bot.run_({ recheck: false });
  assert.deepEqual(Object.keys(world.announcements), []);
});

test('an officer’s post for a subteam role lands in the portal, with a ✅', () => {
  bot.setup();
  const m = post('C1', 'U_LEAD', '<@BOT> <@&R_CHASSIS> # Pool test moved\nNow at **10 AM**, see <#C2>.\n- bring glasses\n- bring the tether');
  const log = bot.run_({ recheck: false });
  const d = doc(m);
  assert.ok(d, 'announcement created');
  assert.equal(str(d.title), 'Pool test moved');
  assert.equal(str(d.body), 'Now at **10 AM**, see #mate-club-mgmt.\n\n- bring glasses\n- bring the tether');
  assert.deepEqual(arr(d.subteams), ['cd-chassis']);
  assert.equal(str(d.source), 'discord');
  assert.equal(str(d.authorName), 'Priya N.');
  assert.equal(d.authorUid.nullValue, null);
  assert.equal(str(d.discord.mapValue.fields.channelName), 'chassis');
  assert.equal(str(d.discord.mapValue.fields.url), `https://discord.com/channels/${N.G}/${N.C1}/${m.id}`);
  assert.ok(!('pinned' in d) && !('hidden' in d), 'leaves pinned and hidden to the portal');
  assert.deepEqual(world.reactions, [{ message: m.id, emoji: '✅' }]);
  assert.equal(world.audit.length, 1);
  assert.match(str(world.audit[0].summary), /Posted “Pool test moved” from #chassis for Chassis \(Crush Depth\) \(sent by Priya N\.\)/);
  assert.equal(log.length, 1);
  // Nothing new: nothing happens.
  world.calls = [];
  bot.run_({ recheck: false });
  assert.ok(!world.calls.some((c) => c.includes('/messages?')), 'no channel was read');
});

test('edits update the announcement; deletes and dropped mentions take it down', () => {
  bot.setup();
  const a = post('C1', 'U_LEAD', '<@BOT> <@&R_CHASSIS> Build day Saturday');
  const b = post('C1', 'U_LEAD', '<@BOT> Lab closed Monday');
  bot.run_({ recheck: false });
  assert.equal(str(doc(a).title), 'Build day Saturday');
  assert.equal(str(doc(b).title), 'Lab closed Monday');
  assert.deepEqual(arr(doc(b).subteams), [], 'no roles means everyone');

  edit(a, '<@BOT> <@&R_CHASSIS> <@&R_FLOAT> Build day moved to Sunday');
  bot.run_({ recheck: true });
  assert.equal(str(doc(a).title), 'Build day moved to Sunday');
  assert.deepEqual(arr(doc(a).subteams), ['cd-chassis', 'cd-float']);
  assert.equal(world.reactions.length, 2, 'no second ✅ for an edit');
  assert.equal(world.audit.length, 2);

  // Deleted in Discord
  const ch = world.channels.find((c) => c.id === N.C1);
  ch.messages = ch.messages.filter((x) => x.id !== a.id);
  bot.run_({ recheck: true });
  assert.equal(doc(a), undefined);
  // The bot's mention edited out
  edit(b, 'Lab closed Monday');
  bot.run_({ recheck: true });
  assert.equal(doc(b), undefined);
});

test('only officers can post; others get a 🚫 and nothing is posted', () => {
  bot.setup();
  const m = post('C1', 'U_MEM', '<@BOT> <@&R_CHASSIS> free pizza');
  bot.run_({ recheck: false });
  assert.equal(doc(m), undefined);
  assert.deepEqual(world.reactions, [{ message: m.id, emoji: '🚫' }]);
  // POSTER_ROLES lets a named role post (and only it).
  world.props.POSTER_ROLES = 'Chassis';
  const m2 = post('C1', 'U_MEM', '<@BOT> <@&R_CHASSIS> frame plates are cut');
  bot.run_({ recheck: false });
  assert.ok(doc(m2));
  const m3 = post('C1', 'U_LEAD', '<@BOT> officer without the listed role');
  bot.run_({ recheck: false });
  assert.equal(doc(m3), undefined);
});

test('@everyone, a subsidiary role and the bot’s own role', () => {
  bot.setup();
  const a = post('C2', 'U_LEAD', '<@BOT> @everyone General meeting is in room 210 today');
  const b = post('C2', 'U_LEAD', '<@&R_BOT> <@&R_MATE> MATE registration is due Friday');
  bot.run_({ recheck: false });
  assert.deepEqual(arr(doc(a).subteams), []);
  assert.equal(str(doc(a).title), 'General meeting is in room 210 today');
  assert.deepEqual(arr(doc(b).subteams).sort(), ['cd-chassis', 'cd-electrical', 'cd-float']);
  assert.equal(str(doc(b).title), 'MATE registration is due Friday');
});

test('a role two subteams share asks for a link instead of guessing, once', () => {
  bot.setup();
  const m = post('C1', 'U_LEAD', '<@BOT> <@&R_ELEC> Tether is ready');
  bot.run_({ recheck: false });
  assert.equal(doc(m), undefined);
  assert.equal(world.replies.length, 1);
  assert.match(world.replies[0].content, /@Electrical isn’t linked to a portal subteam/);
  assert.deepEqual(world.replies[0].allowed_mentions, { parse: [], replied_user: false });
  bot.run_({ recheck: true });
  assert.equal(world.replies.length, 1, 'doesn’t repeat itself');
  // An admin links the role, the lead edits the post: now it goes through.
  world.docs.subteams['cd-electrical'].discordRole = N.R_ELEC;
  edit(m, '<@BOT> <@&R_ELEC> Tether is ready to test');
  bot.run_({ recheck: true });
  assert.deepEqual(arr(doc(m).subteams), ['cd-electrical']);
});

test('a rate limit stops the run without losing anything', () => {
  bot.setup();
  const m = post('C1', 'U_LEAD', '<@BOT> Pool test at 9');
  world.rateLimitMessages = true;
  assert.deepEqual([...bot.poll()], []);
  assert.equal(doc(m), undefined);
  world.rateLimitMessages = false;
  bot.run_({ recheck: false });
  assert.ok(doc(m));
});

test('a channel the bot can’t read is skipped for an hour', () => {
  bot.setup();
  world.cache = {};
  world.channels.push({ id: N.C3, type: 0, name: 'secret', messages: [] });
  bot.run_({ recheck: false }); // first sight: remembers where the channel is
  post('C3', 'U_LEAD', '<@BOT> hi');
  const orig = handle;
  // Discord answers 403 for this channel
  bot.UrlFetchApp.fetchAll = (reqs) => reqs.map((r) => (r.url.includes(`/channels/${N.C3}/`) ? res(403, { message: 'Missing Access' }) : orig(r.url, r)));
  bot.run_({ recheck: false });
  assert.equal(world.cache['noaccess_' + N.C3], '1');
});

test('text clean-up', () => {
  bot.setup();
  const ctx = bot.context_(bot.config_());
  ctx.channelNames = { [N.C2]: 'mate-club-mgmt' };
  const m = { mentions: [{ id: N.U_MEM, global_name: 'Sofia' }] };
  const clean = (s) => bot.cleanText_(x(s), m, ctx);
  assert.equal(clean('<@BOT> <@&R_CHASSIS>, hello <@U_MEM> :) <:party:123> <@&R_FLOAT>'), 'hello @Sofia :) :party:');
  assert.equal(clean('Meet at <t:1700000000:F> in <#C2>, details <https://example.com/x>'), 'Meet at 2023-11-14 22:13 in #mate-club-mgmt, details https://example.com/x');
  assert.equal(clean('__Bring__ ~~nothing~~ ||snacks|| and _gloves_ for snake_case_names'), 'Bring nothing snacks and *gloves* for snake_case_names');
  assert.equal(clean('> quoted\n```\ncode line\n```\n* one\n* two'), 'quoted\ncode line\n\n- one\n- two');
  const long = 'We finished the frame today and it looks great. Next week we start wiring the electronics can and testing the thrusters in the pool, so bring your safety glasses.';
  const parts = bot.splitTitle_(long);
  assert.equal(parts.title, 'We finished the frame today and it looks great.');
  assert.equal(parts.body, long);
  assert.deepEqual({ ...bot.splitTitle_('**Pool test:**\nAt 9') }, { title: 'Pool test', body: 'At 9' });
});

test('helpers: permission bits, snowflakes and Firestore values', () => {
  assert.equal(bot.hasBit_(String(1 << 17), 17), true);
  assert.equal(bot.hasBit_(String(1 << 17), 13), false);
  assert.equal(bot.hasBit_('2251799813685247', 50), true);
  assert.equal(bot.hasBit_('2251799813685248', 51), true);  // 2^51
  assert.equal(bot.hasBit_('2251799813685248', 3), false);
  assert.equal(bot.hasBit_('0', 3), false);
  assert.ok(bot.snowCmp_('1200000000000000002', '999999999999999999') > 0);
  assert.ok(bot.snowCmp_('1200000000000000001', '1200000000000000002') < 0);
  assert.equal(bot.snowCmp_('5', '5'), 0);
  const v = bot.fsFields_({ a: 'x', n: 3, f: 1.5, b: false, z: null, l: [], d: new Date('2026-01-02T03:04:05Z'), m: { k: ['y'] } });
  assert.deepEqual(JSON.parse(JSON.stringify(v)), {
    a: { stringValue: 'x' }, n: { integerValue: '3' }, f: { doubleValue: 1.5 }, b: { booleanValue: false }, z: { nullValue: null },
    l: { arrayValue: {} }, d: { timestampValue: '2026-01-02T03:04:05.000Z' }, m: { mapValue: { fields: { k: { arrayValue: { values: [{ stringValue: 'y' }] } } } } },
  });
  assert.equal(bot.fsPlain_({ mapValue: { fields: { k: { integerValue: '7' } } } }).k, 7);
});

test('missing settings say exactly what to add', () => {
  delete world.props.DISCORD_BOT_TOKEN;
  assert.throws(() => bot.poll(), /Add DISCORD_BOT_TOKEN/);
  world.props.DISCORD_BOT_TOKEN = 'token';
  delete world.props.FIREBASE_PROJECT_ID;
  assert.throws(() => bot.checkSetup(), /Add FIREBASE_PROJECT_ID/);
});

// ───────── Direct messages ─────────

const tick = () => { world.props.DM_LAST = '0'; return bot.run_({ recheck: false }); }; // as if five minutes had passed

test('a newly assigned task DMs each assignee once; tasks from before the bot, old ones and self-assigned ones send nothing', () => {
  const now = Date.now(), day = 86400e3;
  world.docs.spaces = { s1: { name: 'electrical' } };
  world.tasks = [{ id: 't0', spaceId: 's1', title: 'From before', status: 'todo', priority: 'normal', assignees: ['u-sofia'], createdBy: 'u-priya', updatedAt: new Date(now) }];
  bot.setup();
  tick(); // first run only takes note of who's assigned what
  assert.equal(world.dms.length, 0);

  world.tasks.push(
    { id: 't1', spaceId: 's1', title: 'Wire the tether', status: 'todo', priority: 'high', due: '2026-12-05', assignees: ['u-sofia', 'u-priya'], createdBy: 'u-priya', updatedAt: new Date(now) },
    { id: 't2', spaceId: 's1', title: 'Old news', status: 'todo', priority: 'normal', assignees: ['u-sofia'], createdBy: 'u-priya', updatedAt: new Date(now - 10 * day) },
  );
  const log = tick();
  assert.equal(world.dms.length, 1, 'Sofia only: Priya assigned herself, and t2 is old');
  assert.equal(world.dms[0].to, N.U_MEM);
  assert.match(world.dms[0].content, /^You have a new task on the portal: \*\*Wire the tether\*\* \(#electrical, due .+, high priority\)\. Your tasks: https:\/\/engineeringrenaissance\.org\/portal\/#\/tasks$/);
  assert.deepEqual(world.dms[0].allowed_mentions, { parse: [] });
  assert.ok(log.some((l) => l.startsWith('DM to Sofia (@sofia) about the task "Wire the tether"')));

  tick();
  assert.equal(world.dms.length, 1, 'no repeats');

  world.tasks[1].assignees.push('u-max');
  assert.ok(tick().some((l) => /^No DM to Max about the task "Wire the tether": no Discord username/.test(l)));
  assert.ok(!tick().some((l) => /Max/.test(l)), 'and that is said once, not every run');

  world.tasks[1].assignees = ['u-priya', 'u-max']; tick();
  world.tasks[1].assignees = ['u-priya', 'u-max', 'u-sofia']; tick();
  assert.equal(world.dms.length, 2, 'taken off and put back on: told again');

  world.tasks = world.tasks.filter((t) => t.id !== 't1'); tick();
  assert.equal(world.props.dmt_t1, undefined, 'a deleted task is forgotten');
});

test('a subtask’s DM names the task it’s part of', () => {
  const now = new Date();
  world.docs.spaces = { s1: { name: 'electrical' } };
  world.tasks = [{ id: 'pcb', spaceId: 's1', title: 'Custom PCB', status: 'doing', priority: 'high', assignees: ['u-priya'], createdBy: 'u-priya', updatedAt: now }];
  bot.setup();
  tick();
  world.tasks.push({ id: 'layout', spaceId: 's1', parentId: 'pcb', title: 'Lay out the board', status: 'todo', priority: 'normal', assignees: ['u-sofia'], createdBy: 'u-priya', updatedAt: now });
  tick();
  assert.equal(world.dms.length, 1);
  assert.match(world.dms[0].content, /^You have a new task on the portal: \*\*Lay out the board\*\* \(part of Custom PCB, #electrical\)\./);
});

test('someone clocked in past the session limit gets one DM per session; blocked DMs are noted once', () => {
  const now = Date.now(), hour = 3600e3;
  world.settings = { maxSessionHours: 8 };
  world.docs.presence = {
    'u-sofia': { uid: 'u-sofia', entryId: 'e1', start: new Date(now - 9 * hour), name: 'Sofia' },
    'u-max': { uid: 'u-max', entryId: 'e2', start: new Date(now - 2 * hour), name: 'Max' },
    'u-priya': { uid: 'u-priya', entryId: 'e3', start: new Date(now - 12 * hour), name: 'Priya' },
  };
  world.dmBlocked = [N.U_LEAD];
  bot.setup();
  const log = tick();
  assert.equal(world.dms.length, 1, 'Sofia: Max is under the limit, Priya blocks DMs');
  assert.equal(world.dms[0].to, N.U_MEM);
  assert.match(world.dms[0].content, /clocked in to the portal for more than 8 hours, since .+ Sessions this long need a lead’s OK: https:\/\/engineeringrenaissance\.org\/portal\/$/);
  assert.ok(log.some((l) => /^No DM to Priya about a 12-hour clock-in: their Discord settings block DMs/.test(l)));
  assert.ok(!tick().some((l) => /Priya/.test(l)));
  assert.equal(world.dms.length, 1, 'once per session');
  delete world.docs.presence['u-sofia']; tick();
  assert.deepEqual(Object.keys(JSON.parse(world.props.DM_LONG)), ['e3'], 'clocked-out sessions are forgotten');
});

test('DMs: every five minutes at most, the portal’s default limit, usernames as people type them, and an off switch', () => {
  bot.setup();
  assert.match(bot.checkSetup(), /DMs: 2 of 3 active members have a Discord username on their portal profile\. .+ more than 10 hours\./);
  const reads = () => world.calls.filter((c) => c.includes('/documents/presence')).length;
  bot.run_({ recheck: false });
  const n = reads();
  assert.ok(n > 0);
  bot.run_({ recheck: false });
  assert.equal(reads(), n, 'not again within five minutes');

  assert.equal(bot.discordHandle_(' @Sofia_R '), 'sofia_r');
  assert.equal(bot.discordHandle_('oldname#1234'), 'oldname');
  const cfg = bot.config_(), ctx = { guildId: N.G };
  assert.equal(bot.discordUserId_(cfg, ctx, 'priya'), N.U_LEAD);
  assert.equal(bot.discordUserId_(cfg, ctx, 'priya n.'), N.U_LEAD, 'a nickname works when nobody else has it');
  assert.equal(bot.discordUserId_(cfg, ctx, 'nobody'), null);

  world.props.DIRECT_MESSAGES = 'off';
  const before = reads(); tick();
  assert.equal(reads(), before, 'off means off');
  assert.match(bot.checkSetup(), /DMs are off/);
});

