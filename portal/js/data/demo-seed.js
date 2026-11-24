// Sample data for demo mode. Every person here is fictional.
import { addDays, startOfDay, startOfWeek, isoDate } from '../lib/time.js';

function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const at = (day, h, m = 0) => { const d = new Date(day); d.setHours(h, m, 0, 0); return d; };
const p = (text) => ({ type: 'paragraph', data: { text } });
const h = (text, level = 2) => ({ type: 'header', data: { text, level } });
const ul = (items, style = 'unordered') => ({ type: 'list', data: { style, meta: {}, items: items.map((t) => (typeof t === 'string' ? { content: t, meta: {}, items: [] } : t)) } });
const todo = (content, checked = false) => ({ content, meta: { checked }, items: [] });
const drive = (name, mimeType) => ({ type: 'drive', data: { file: { id: 'demo-' + name.replace(/\W+/g, '-').toLowerCase(), name, mimeType, url: '', demo: true } } });

export const PERSONAS = [
  { key: 'admin', label: 'Admin', uid: 'u-alex' },
  { key: 'lead', label: 'Lead', uid: 'u-priya' },
  { key: 'member', label: 'Member', uid: 'u-sofia' },
  { key: 'pending', label: 'Applicant (waiting)', uid: 'u-ryan' },
  { key: 'visitor', label: 'New visitor', uid: 'u-visitor' },
];
export const VISITOR = { uid: 'u-visitor', email: 'taylor.morgan@example.com', name: 'Taylor Morgan', photoURL: null };

export function buildSeed() {
  const now = new Date();
  const today = startOfDay(now);
  const r = rng(20261124);
  const pickOne = (arr) => arr[Math.floor(r() * arr.length)];

  const subteams = {
    mechanical: { name: 'Mechanical', color: 'lime', order: 1 },
    electrical: { name: 'Electrical & Software', color: 'sky', order: 2 },
    media: { name: 'Media', color: 'orange', order: 3 },
    business: { name: 'Business', color: 'navy', order: 4 },
  };
  const activities = {
    meeting: { name: 'General meeting', subteamId: null, order: 1 },
    build: { name: 'ROV build & fabrication', subteamId: 'mechanical', order: 2 },
    cad: { name: 'CAD & design', subteamId: 'mechanical', order: 3 },
    wiring: { name: 'Electronics & wiring', subteamId: 'electrical', order: 4 },
    code: { name: 'Software & controls', subteamId: 'electrical', order: 5 },
    pool: { name: 'Pool test', subteamId: null, order: 6 },
    docs: { name: 'Technical documentation', subteamId: null, order: 7 },
    media: { name: 'Photo, video & social', subteamId: 'media', order: 8 },
    sponsors: { name: 'Fundraising & sponsors', subteamId: 'business', order: 9 },
    outreach: { name: 'Outreach event', subteamId: null, order: 10 },
    intro: { name: 'Intro projects', subteamId: null, order: 11 },
  };
  const subActs = {
    mechanical: ['build', 'build', 'cad'], electrical: ['wiring', 'code', 'code'],
    business: ['sponsors', 'docs'], media: ['media', 'media', 'docs'],
  };

  const people = [
    ['u-alex', 'Alex Rivera', 'admin', 'President', ['business'], 'Mechanical Engineering', 'he/him'],
    ['u-priya', 'Priya Natarajan', 'lead', 'Director of Software', ['electrical'], 'Computer Science', 'she/her'],
    ['u-marcus', 'Marcus Lee', 'lead', 'Director of Manufacturing', ['mechanical'], 'Manufacturing Technology', 'he/him'],
    ['u-hannah', 'Hannah Okafor', 'lead', 'Director of Marketing', ['media', 'business'], 'Business Administration', 'she/her'],
    ['u-sofia', 'Sofia Delgado', 'member', '', ['mechanical'], 'Mechanical Engineering', 'she/her'],
    ['u-jordan', 'Jordan Kim', 'member', '', ['electrical'], 'Electrical Engineering', 'they/them'],
    ['u-emily', 'Emily Chen', 'member', '', ['media'], 'Graphic Design', 'she/her'],
    ['u-diego', 'Diego Ramirez', 'member', '', ['mechanical'], 'Civil Engineering', 'he/him'],
    ['u-ethan', 'Ethan Brooks', 'member', '', ['electrical'], 'Computer Engineering', 'he/him'],
    ['u-maya', 'Maya Thompson', 'member', '', ['business'], 'Accounting', 'she/her'],
    ['u-noah', 'Noah Patel', 'member', '', ['mechanical', 'electrical'], 'Mechanical Engineering', 'he/him'],
    ['u-isabella', 'Isabella Cruz', 'member', '', ['media'], 'Communication', 'she/her'],
    ['u-liam', 'Liam Nguyen', 'member', '', ['electrical'], 'Computer Science', 'he/him'],
    ['u-ava', 'Ava Martinez', 'member', '', ['mechanical'], 'Physics', 'she/her'],
    ['u-samuel', 'Samuel Ortiz', 'member', '', ['business'], 'Economics', 'he/him'],
    ['u-chloe', 'Chloe Williams', 'member', '', ['electrical'], 'Electrical Engineering', 'she/her'],
  ];
  const skillsBy = {
    mechanical: ['SolidWorks', 'Onshape', 'Machining', '3D printing'],
    electrical: ['Arduino', 'ESP32', 'Python', 'C++', 'PCB design'],
    business: ['Grant writing', 'Budgets', 'Outreach'],
    media: ['Photography', 'Premiere Pro', 'Figma'],
  };
  const users = {};
  people.forEach(([uid, name, role, title, subs, major, pronouns], i) => {
    users[uid] = {
      uid, email: name.toLowerCase().replace(/\s+/g, '.') + '@example.com', name, photoURL: null, role, status: 'active', subteams: subs,
      title, major, pronouns, bio: i < 4 ? `Officer for the ${subs.map((s) => subteams[s].name).join(' and ')} side of the club.` : '',
      skills: skillsBy[subs[0]].slice(0, 3), links: {}, joinNote: '', createdAt: addDays(today, -200 + i * 5),
    };
  });
  users['u-ryan'] = { uid: 'u-ryan', email: 'ryan.foster@example.com', name: 'Ryan Foster', photoURL: null, role: 'member', status: 'pending', subteams: ['mechanical'], title: '', major: 'Engineering', pronouns: '', bio: '', skills: [], links: {}, joinNote: 'Saw your ROV at the club fair. I have some welding experience and want to help with the frame.', createdAt: addDays(now, -1) };
  users['u-grace'] = { uid: 'u-grace', email: 'grace.liu@example.com', name: 'Grace Liu', photoURL: null, role: 'member', status: 'pending', subteams: ['media'], title: '', major: 'Film', pronouns: 'she/her', bio: '', skills: [], links: {}, joinNote: 'I make short videos and would love to film the pool tests.', createdAt: addDays(now, -3) };

  // ── Events: Friday meetings (weekly), pool tests, outreach ──
  const events = {};
  const weekStart = startOfWeek(today);
  for (let w = -8; w <= 6; w++) {
    const fri = addDays(weekStart, w * 7 + 4);
    events[`ev-meet-${w}`] = { title: 'General meeting', type: 'meeting', start: at(fri, 17), end: at(fri, 19), location: 'Engineering lab', description: 'Weekly all-hands. Subteam updates, then build time.', subteams: [], seriesId: 'fridays' };
  }
  const sat = (w) => addDays(weekStart, w * 7 + 5);
  events['ev-pool-1'] = { title: 'Pool test: buoyancy and thrusters', type: 'pool', start: at(sat(-2), 9), end: at(sat(-2), 12), location: 'CCC pool', description: 'Bring safety glasses and the tether spool.', subteams: ['mechanical', 'electrical'] };
  events['ev-pool-2'] = { title: 'Pool test: manipulator trials', type: 'pool', start: at(sat(0) < today ? sat(1) : sat(0), 9), end: at(sat(0) < today ? sat(1) : sat(0), 12), location: 'CCC pool', description: 'Gripper v2 and camera tilt. Software team runs the control station.', subteams: ['mechanical', 'electrical'] };
  events['ev-outreach'] = { title: 'Robotics demo for 7th graders', type: 'outreach', start: at(addDays(weekStart, 9), 13), end: at(addDays(weekStart, 9), 15), location: 'Partner middle school', description: 'Bring the 2024 Pioneer ROV and the demo tank.', subteams: ['media', 'business'] };
  events['ev-fund'] = { title: 'Sponsor thank-you night', type: 'social', start: at(addDays(weekStart, 17), 18), end: at(addDays(weekStart, 17), 20), location: 'Student Center', description: 'Thank our sponsors with a showcase of the 2026 vehicle.', subteams: ['business'] };
  events['ev-build'] = { title: 'Build day: frame v3', type: 'build', start: at(addDays(weekStart, 1), 14), end: at(addDays(weekStart, 1), 17), location: 'Fab lab', description: 'Cutting and tapping the new frame plates.', subteams: ['mechanical'] };

  // ── Time entries ──
  const timeEntries = {};
  let n = 0;
  const active = Object.values(users).filter((u) => u.status === 'active');
  const add = (u, start, end, extra = {}) => {
    const sub = u.subteams[0];
    const act = extra.activityId || pickOne(subActs[sub]);
    timeEntries['te-' + (++n)] = {
      uid: u.uid, name: u.name, start, end, status: 'complete', source: 'clock', activityId: act,
      subteamId: extra.subteamId !== undefined ? extra.subteamId : (activities[act]?.subteamId || sub), eventId: extra.eventId || null,
      note: extra.note || '', outNote: extra.outNote || '', geo: null, createdAt: start, ...extra.more,
    };
    return 'te-' + n;
  };
  for (let w = -8; w <= 0; w++) {
    const fri = addDays(weekStart, w * 7 + 4);
    active.forEach((u, i) => {
      // Friday meetings
      if (fri < today && r() < 0.78) {
        const s = at(fri, 17, Math.floor(r() * 15)), e = at(fri, 18, 50 + Math.floor(r() * 25));
        add(u, s, e, { activityId: r() < 0.45 ? 'meeting' : null, eventId: `ev-meet-${w}`, subteamId: u.subteams[0] });
      }
      // Build sessions on Tue/Thu/Sat
      [1, 3, 5].forEach((dow) => {
        const day = addDays(weekStart, w * 7 + dow);
        if (day >= today) return;
        if (r() < (i < 4 ? 0.45 : 0.28)) {
          const sh = 13 + Math.floor(r() * 4), dur = 60 + Math.floor(r() * 150);
          const s = at(day, sh, Math.floor(r() * 50));
          add(u, s, new Date(s.getTime() + dur * 60000), { note: r() < 0.2 ? 'Worked on ' + pickOne(['thruster mounts', 'tether strain relief', 'camera housing', 'PID tuning', 'sponsor emails', 'poster layout']) : '' });
        }
      });
    });
  }
  // Two forgotten clock-outs waiting for approval, one rejected
  const y = addDays(today, -1);
  const fixA = add(users['u-diego'], at(y, 15, 2), at(y, 18, 30), { more: { status: 'pending', fix: { reason: 'Forgot to clock out after the build session. Left right after we cleaned up.', requestedAt: at(today, 9, 12) } } });
  add(users['u-jordan'], at(addDays(today, -2), 16, 0), at(addDays(today, -2), 19, 15), { more: { status: 'pending', fix: { reason: 'Phone died, I left at 7:15.', requestedAt: at(addDays(today, -1), 8, 40) } } });
  add(users['u-ethan'], at(addDays(today, -12), 10, 0), at(addDays(today, -12), 21, 0), { more: { status: 'rejected', reviewNote: 'The lab closed at 6. Ask a lead to add the real time.', reviewedBy: 'u-priya', reviewedAt: addDays(today, -11), fix: { reason: 'Forgot to clock out', requestedAt: addDays(today, -11) } } });
  void fixA;

  // People in the lab right now
  const presence = {};
  [['u-marcus', 'build', 52], ['u-jordan', 'code', 88], ['u-emily', 'media', 23]].forEach(([uid, act, mins]) => {
    const u = users[uid];
    const s = new Date(now.getTime() - mins * 60000);
    const id = add(u, s, null, { activityId: act, more: { status: 'open' } });
    presence[uid] = { uid, entryId: id, start: s, name: u.name, photoURL: null, activityId: act, subteamId: activities[act].subteamId };
  });

  // ── Spaces and pages ──
  const spaces = {
    club: { name: 'Club HQ', icon: '🐂', color: 'navy', order: 1, memberEdit: false, description: 'How the club runs: onboarding, safety, meeting notes and officer docs.', driveFolder: null },
    crush: { name: 'Crush Depth', icon: '🌊', color: 'sky', order: 2, memberEdit: true, description: 'The MATE ROV competition team: season plan, design log and pool tests.', driveFolder: { id: 'demo-crush-folder', name: 'Crush Depth 2027', url: '' } },
    mechanical: { name: 'Mechanical', icon: '⚙️', color: 'lime', order: 3, memberEdit: true, description: 'Frame, thrusters, manipulators and machining.', driveFolder: null },
    electrical: { name: 'Electrical & Software', icon: '⚡', color: 'sky', order: 4, memberEdit: true, description: 'Power, tether, control station and code.', driveFolder: null },
    business: { name: 'Business', icon: '💼', color: 'navy', order: 5, memberEdit: true, description: 'Sponsors, budget, fundraising and outreach.', driveFolder: null },
    media: { name: 'Media', icon: '🎬', color: 'orange', order: 6, memberEdit: true, description: 'Photos, video, social and the marketing display.', driveFolder: null },
  };
  const pages = {};
  const mk = (id, spaceId, parentId, title, icon, blocks, by = 'u-alex', daysAgo = 3) => {
    const u = users[by];
    pages[id] = { spaceId, parentId, title, icon, order: Object.keys(pages).length + 1, content: { blocks }, rev: 1, createdBy: by, createdByName: u.name, createdAt: addDays(now, -daysAgo - 20), updatedBy: by, updatedByName: u.name, updatedAt: addDays(now, -daysAgo) };
  };
  mk('pg-welcome', 'club', null, 'Welcome to Engineering Renaissance', '👋', [
    p('This is the home for everything the club runs on. Start here if you are new.'),
    h('Your first two weeks'),
    ul([todo('Sign in to the portal and fill out your profile', true), todo('Come to a Friday meeting (5–7 PM in the engineering lab)'), todo('Read the lab safety rules and sign the sheet'), todo('Pick an intro project team')], 'checklist'),
    h('How hours work'),
    p('Tap <b>Clock in</b> on the Home tab when you start working and <b>Clock out</b> when you leave. Forgot to clock out? Open the portal and tell us when you left. A lead approves it.'),
    { type: 'warning', data: { title: 'Travel eligibility', message: 'Competition travel spots are based on term hours and attendance. Keep your hours up to date.' } },
  ], 'u-alex', 6);
  mk('pg-safety', 'club', null, 'Lab safety rules', '⚠️', [
    p('Safety comes before speed. These rules apply in the fab lab and at every pool test.'),
    ul(['Safety glasses on whenever tools are running', 'No solo power-tool use', 'Lithium batteries charge in the fire bag only', 'Report every injury to the Director of Safety the same day'], 'ordered'),
    drive('Lab safety sign-off sheet', 'application/vnd.google-apps.spreadsheet'),
  ], 'u-alex', 30);
  mk('pg-notes', 'club', null, 'Meeting notes', '📝', [p('Notes from every Friday meeting, newest first.')], 'u-hannah', 2);
  mk('pg-notes-1', 'club', 'pg-notes', 'Notes: last Friday', '🗓️', [
    h('Updates', 3), ul(['Mechanical: frame v3 plates are cut, tapping next week', 'Software: new joystick mapping merged', 'Business: two sponsor meetings booked']),
    h('Action items', 3), ul([todo('Order replacement thruster props', false), todo('Post pool-test photos', true)], 'checklist'),
  ], 'u-hannah', 2);
  mk('pg-season', 'crush', null, 'MATE 2027 season plan', '🏆', [
    p('Our plan for the Explorer class season. Dates move as the competition manual comes out.'),
    { type: 'table', data: { withHeadings: true, content: [['Phase', 'Goal', 'Owner'], ['Design review', 'Frozen frame and electronics layout', 'Marcus'], ['First wet test', 'Neutral buoyancy, all thrusters running', 'Priya'], ['Tech documentation', 'Draft of the technical report', 'Hannah']] } },
    drive('Crush Depth 2027 technical report', 'application/vnd.google-apps.document'),
  ], 'u-marcus', 4);
  mk('pg-pool', 'crush', null, 'Pool test checklist', '🏊', [
    ul([todo('Charge the topside battery', true), todo('Pressure-test the electronics can', false), todo('Pack spare props and zip ties', false), todo('Assign a safety diver', false)], 'checklist'),
  ], 'u-priya', 1);
  mk('pg-designlog', 'crush', null, 'ROV design log', '📐', [p('Decisions, trade-offs and test results, one entry per change.'), h('Thruster layout', 3), p('Moved to a vectored 4 + 2 layout for better strafing. See the CAD in the mechanical space.')], 'u-noah', 9);
  mk('pg-frame', 'mechanical', null, 'Frame v3 design notes', '🔩', [p('HDPE plates, 1/2 in. Holes tapped for 1/4-20.'), drive('Frame v3 drawings', 'application/pdf')], 'u-marcus', 5);
  mk('pg-machining', 'mechanical', null, 'Machining requests', '🧰', [p('Add a row before you need a part. Include the drawing link.')], 'u-marcus', 12);
  mk('pg-wiring', 'electrical', null, 'Wiring standards', '🔌', [ul(['Red is +12 V, black is ground, no exceptions', 'Label both ends of every cable', 'Heat-shrink every splice'])], 'u-priya', 15);
  mk('pg-code', 'electrical', null, 'Control code setup', '💻', [
    p('Our control code lives on GitHub: <a href="https://github.com/CCC-Engineering-Renaissance/Control-Systems-Code">CCC-Engineering-Renaissance/Control-Systems-Code</a>.'),
    { type: 'code', data: { code: 'git clone https://github.com/CCC-Engineering-Renaissance/Control-Systems-Code\ncd Control-Systems-Code' } },
  ], 'u-priya', 7);
  mk('pg-sponsors', 'business', null, 'Sponsorship pipeline', '🤝', [p('Who we are talking to and where each conversation stands.'), drive('Sponsor tracker', 'application/vnd.google-apps.spreadsheet')], 'u-hannah', 3);
  mk('pg-brand', 'media', null, 'Brand guide', '🎨', [p('Colors: deep #273784, sky #2CB5DE, lime #98C741. Headlines in Chakra Petch.'), drive('Logo pack', 'application/vnd.google-apps.folder')], 'u-emily', 20);
  Object.entries(spaces).forEach(([sid, s]) => {
    s.tree = Object.entries(pages).filter(([, pg]) => pg.spaceId === sid).map(([id, pg]) => ({ id, title: pg.title, icon: pg.icon, parentId: pg.parentId, order: pg.order }));
  });

  // ── Tasks ──
  const tasks = {};
  let tn = 0;
  const task = (spaceId, title, status, assignees, dueIn, priority = 'normal', description = '') => {
    tasks['tk-' + (++tn)] = { spaceId, title, description, status, assignees, due: dueIn == null ? null : isoDate(addDays(today, dueIn)), priority, labels: [], order: tn, createdBy: 'u-alex', createdAt: addDays(now, -10), updatedAt: addDays(now, -tn % 4), completedAt: status === 'done' ? addDays(now, -1) : null };
  };
  task('crush', 'Freeze the thruster layout', 'doing', ['u-marcus', 'u-noah'], 3, 'high', 'Decide between 4+2 vectored and 6 vertical before the design review.');
  task('crush', 'Book the pool for two more Saturdays', 'todo', ['u-alex'], 6);
  task('crush', 'Draft the safety section of the tech report', 'todo', ['u-sofia'], 10);
  task('crush', 'Waterproof the camera housing', 'blocked', ['u-ava'], -1, 'high', 'Waiting on O-rings from McMaster.');
  task('crush', 'Record the 2026 vehicle walkthrough video', 'done', ['u-emily'], -3);
  task('mechanical', 'Tap frame plate holes', 'doing', ['u-sofia', 'u-diego'], 2);
  task('mechanical', 'Print gripper v2 jaws', 'todo', ['u-ava'], 5);
  task('electrical', 'Tune depth-hold PID', 'doing', ['u-priya', 'u-liam'], 4, 'high');
  task('electrical', 'Crimp new tether connectors', 'todo', ['u-jordan', 'u-chloe'], 8);
  task('electrical', 'Update joystick mapping docs', 'done', ['u-ethan'], -2);
  task('business', 'Send sponsorship packet to three new companies', 'doing', ['u-maya', 'u-samuel'], 7);
  task('business', 'Reconcile October receipts', 'todo', ['u-alex'], 2, 'high');
  task('media', 'Post pool-test reel', 'todo', ['u-isabella'], 1);
  task('media', 'Update marketing display panel', 'todo', ['u-hannah', 'u-emily'], 14);

  // ── Announcements ──
  const announcements = {
    'an-1': { title: 'Welcome to the new member portal', body: 'Clock in and out right here instead of the old site. Tap **Clock in** on Home when you start and **Clock out** when you leave.\n\nForgot to clock out? Open the portal and tell us when you left. A lead approves it.', subteams: [], pinned: true, authorUid: 'u-alex', authorName: 'Alex Rivera', authorPhoto: null, createdAt: addDays(now, -2), updatedAt: addDays(now, -2) },
    'an-2': { title: 'Pool test this Saturday', body: 'Meet at the pool at 9 AM. Bring safety glasses.\n- Mechanical: gripper v2\n- Software: control station laptop', subteams: ['mechanical', 'electrical'], pinned: false, authorUid: 'u-priya', authorName: 'Priya Natarajan', authorPhoto: null, createdAt: addDays(now, -1), updatedAt: addDays(now, -1) },
    'an-3': { title: 'Sponsorship packet draft is ready', body: 'Review it in the Business space and leave comments by Thursday.', subteams: ['business'], pinned: false, authorUid: 'u-hannah', authorName: 'Hannah Okafor', authorPhoto: null, createdAt: addDays(now, -4), updatedAt: addDays(now, -4) },
    'an-4': { title: 'Halloween project photos are up', body: 'Find them in the Media space. Tag yourself when you share them.', subteams: [], pinned: false, authorUid: 'u-hannah', authorName: 'Hannah Okafor', authorPhoto: null, createdAt: addDays(now, -9), updatedAt: addDays(now, -9) },
  };

  const settings = {
    clubName: 'Engineering Renaissance', meetingInfo: 'Fridays, 5–7 PM in the engineering lab', termName: 'Fall 2026', termStart: '2026-08-10', termEnd: '2026-12-12',
    termGoalHours: 40, weeklyGoalHours: 4, maxSessionHours: 10, locationCheck: { enabled: false, mode: 'flag', lat: null, lng: null, radiusM: 250 },
  };

  const invites = { 'new.officer@example.com': { email: 'new.officer@example.com', role: 'lead', subteams: ['media'], title: 'Social Media Lead', invitedBy: 'u-alex', invitedByName: 'Alex Rivera', createdAt: addDays(now, -1) } };
  const audit = {
    'au-1': { at: addDays(now, -1), actorUid: 'u-priya', actorName: 'Priya Natarajan', action: 'entry.reject', summary: 'Didn’t count Ethan Brooks’s 11 h session', targetType: 'timeEntry', targetId: null },
    'au-2': { at: addDays(now, -3), actorUid: 'u-alex', actorName: 'Alex Rivera', action: 'member.approve', summary: 'Approved Chloe Williams as a member', targetType: 'user', targetId: 'u-chloe' },
  };

  return { users, subteams, activities, events, timeEntries, presence, spaces, pages, tasks, announcements, config: { settings }, invites, audit };
}
