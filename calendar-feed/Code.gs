// Engineering Renaissance: calendar feed.
//
// Each member's link (made in the portal under Calendar → Subscribe) returns club events as an
// iCalendar feed. Google Calendar, Apple Calendar and Outlook subscribe to it and check it again on
// their own, so new and changed events show up without anyone doing anything.
//
// A link shows club-wide events (ones not tied to a subteam) plus the subteams its owner picked, or
// everything. It stops working when its owner is no longer an active member or turns it off.
//
// It runs as the club Google account and reads Firestore directly, so security rules don't apply
// to it; it only ever hands out events. Setup: SETUP.md step 9.

var FEED = {
  site: 'https://engineeringrenaissance.org/portal/',
  domain: 'engineeringrenaissance.org',
  name: 'Engineering Renaissance',
  pastDays: 60,        // events that ended up to this long ago stay on people's calendars
  cacheSeconds: 300,   // a link's finished feed, and the event list, are reused for 5 minutes
};
var TYPES = {
  meeting: 'Meeting', build: 'Build day', pool: 'Pool test', competition: 'Competition',
  outreach: 'Outreach', social: 'Social', other: 'Other',
};

// Calendar apps fetch the web app's address with ?k=<the member's link id>.
function doGet(e) {
  var key = String((e && e.parameter && e.parameter.k) || '');
  return ContentService.createTextOutput(feedFor_(key)).setMimeType(ContentService.MimeType.ICAL);
}

// Run this once from the editor after setting FIREBASE_PROJECT_ID: it asks for permission and
// checks that the script can read the database.
function checkSetup() {
  var events = clubEvents_(true);
  var names = subteamNames_(true);
  Logger.log('Firestore OK. %s events from the last %s days on, %s subteams.', events.length, FEED.pastDays, Object.keys(names).length);
  Logger.log('Next: Deploy → New deployment → Web app, and paste its address into the portal (Admin → Settings).');
}

function feedFor_(key) {
  if (!/^[A-Za-z0-9]{32}$/.test(key)) return ics_([], { off: true });
  var cache = CacheService.getScriptCache();
  var hit = cache.get('feed:' + key);
  if (hit) return hit;
  var feed = getDoc_('calendarFeeds/' + key);
  var user = feed && feed.uid ? getDoc_('users/' + feed.uid) : null;
  var text;
  if (!feed || !user || user.status !== 'active') {
    text = ics_([], { off: true });
  } else {
    var picked = {};
    (feed.subteams || []).forEach(function (id) { picked[id] = true; });
    var events = clubEvents_().filter(function (ev) {
      var teams = ev.subteams || [];
      return feed.everything === true || !teams.length || teams.some(function (id) { return picked[id]; });
    });
    text = ics_(events, { names: subteamNames_() });
  }
  if (text.length < 95000) cache.put('feed:' + key, text, FEED.cacheSeconds);
  return text;
}

// Events that haven't ended, plus the last couple of months.
function clubEvents_(fresh) {
  var cache = CacheService.getScriptCache();
  var hit = !fresh && cache.get('events');
  if (hit) return JSON.parse(hit);
  var since = new Date(Date.now() - FEED.pastDays * 864e5).toISOString();
  var events = runQuery_({
    from: [{ collectionId: 'events' }],
    where: { fieldFilter: { field: { fieldPath: 'end' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: since } } },
    orderBy: [{ field: { fieldPath: 'end' }, direction: 'ASCENDING' }],
    limit: 1000,
  }).filter(function (ev) { return ev.start && ev.end; }).map(function (ev) {
    return {
      id: ev.id, title: ev.title || 'Club event', start: ev.start, end: ev.end, location: ev.location || '',
      description: ev.description || '', type: ev.type || 'other', subteams: ev.subteams || [],
      changed: ev.updatedAt || ev.createdAt || null,
    };
  });
  var json = JSON.stringify(events);
  if (json.length < 95000) cache.put('events', json, FEED.cacheSeconds);
  return events;
}

// Subteam names for "For: Electrical (Crush Depth)" in each event's notes.
function subteamNames_(fresh) {
  var cache = CacheService.getScriptCache();
  var hit = !fresh && cache.get('subteams');
  if (hit) return JSON.parse(hit);
  var groups = {};
  listDocs_('subsidiaries').forEach(function (s) { groups[s.id] = s.name; });
  var names = {};
  listDocs_('subteams').forEach(function (t) {
    names[t.id] = (t.name || t.id) + (t.subsidiaryId && groups[t.subsidiaryId] ? ' (' + groups[t.subsidiaryId] + ')' : '');
  });
  cache.put('subteams', JSON.stringify(names), 3600);
  return names;
}

// ── iCalendar (RFC 5545) ──
function ics_(events, opts) {
  opts = opts || {};
  var now = stamp_(new Date());
  var lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Engineering Renaissance//Member Portal//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + text_(opts.off ? FEED.name + ' (link turned off)' : FEED.name),
    'X-WR-CALDESC:' + text_(opts.off
      ? 'This calendar link is turned off. Get a new one in the member portal: Calendar, then Subscribe.'
      : 'Club events from the Engineering Renaissance member portal.'),
    'X-WR-TIMEZONE:America/Los_Angeles',
    // Hints for apps that honor them (Apple Calendar, Outlook): check about once an hour.
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  events.forEach(function (ev) {
    var who = (ev.subteams || []).map(function (id) { return (opts.names || {})[id]; }).filter(Boolean);
    var notes = [ev.description, who.length ? 'For: ' + who.join(', ') : '', 'In the portal: ' + FEED.site + '#/calendar'];
    lines.push('BEGIN:VEVENT', 'UID:' + ev.id + '@' + FEED.domain, 'DTSTAMP:' + now,
      'DTSTART:' + stamp_(new Date(ev.start)), 'DTEND:' + stamp_(new Date(ev.end)), 'SUMMARY:' + text_(ev.title));
    if (ev.location) lines.push('LOCATION:' + text_(ev.location));
    lines.push('DESCRIPTION:' + text_(notes.filter(Boolean).join('\n\n')), 'CATEGORIES:' + text_(TYPES[ev.type] || TYPES.other),
      'URL:' + FEED.site + '#/calendar');
    if (ev.changed) {
      var changed = new Date(ev.changed);
      // A later edit means a higher number, which tells calendar apps to replace their copy.
      lines.push('LAST-MODIFIED:' + stamp_(changed), 'SEQUENCE:' + Math.max(0, Math.floor((changed.getTime() - Date.UTC(2024, 0, 1)) / 1000)));
    }
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold_).join('\r\n') + '\r\n';
}

function stamp_(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function text_(s) {
  return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/[,;]/g, function (c) { return '\\' + c; });
}
// Lines over 75 bytes continue on the next line after a space, split between whole characters.
function fold_(line) {
  var parts = [];
  var cur = '';
  var bytes = 0;
  for (var i = 0; i < line.length;) {
    var cp = line.codePointAt(i);
    var ch = String.fromCodePoint(cp);
    i += ch.length;
    var n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + n > (parts.length ? 74 : 75)) { parts.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

// ── Firestore over REST, as the club account ──
function base_() {
  var pid = PropertiesService.getScriptProperties().getProperty('FIREBASE_PROJECT_ID');
  if (!pid) throw new Error('Add the FIREBASE_PROJECT_ID script property first (SETUP.md step 9).');
  return { pid: pid, url: 'https://firestore.googleapis.com/v1/projects/' + pid + '/databases/(default)/documents' };
}
function call_(method, path, body) {
  var b = base_();
  var options = {
    method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': b.pid },
  };
  if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
  var res = UrlFetchApp.fetch(b.url + path, options);
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code >= 300) throw new Error('Firestore said ' + code + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || 'null');
}
function getDoc_(path) { var d = call_('get', '/' + path); return d ? decodeDoc_(d) : null; }
function runQuery_(q) {
  return (call_('post', ':runQuery', { structuredQuery: q }) || [])
    .filter(function (r) { return r.document; })
    .map(function (r) { return decodeDoc_(r.document); });
}
function listDocs_(coll) {
  var out = [];
  var token = '';
  do {
    var page = call_('get', '/' + coll + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : '')) || {};
    (page.documents || []).forEach(function (d) { out.push(decodeDoc_(d)); });
    token = page.nextPageToken || '';
  } while (token);
  return out;
}
function decodeDoc_(d) {
  var o = decodeFields_(d.fields || {});
  o.id = String(d.name).split('/').pop();
  return o;
}
function decodeFields_(f) {
  var o = {};
  Object.keys(f).forEach(function (k) { o[k] = decode_(f[k]); });
  return o;
}
function decode_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode_);
  if ('mapValue' in v) return decodeFields_(v.mapValue.fields || {});
  return null;
}
