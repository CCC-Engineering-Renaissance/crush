/**
 * Engineering Renaissance member portal: Discord announcements bot.
 *
 * Runs in Google Apps Script under the club Google account, so there is no server to keep
 * running. Every minute it checks the Discord server for new posts that mention the bot, and
 * copies each one into the portal's announcements:
 *   - for the subteams whose Discord roles the post mentions (a role linked to a subsidiary
 *     means every subteam in it), or
 *   - for everyone when the post says @everyone or @here, or mentions no roles.
 * Editing the Discord post updates the announcement; deleting it (or removing the bot's mention)
 * takes it down. The bot reacts with ✅ when a post is on the portal.
 *
 * Only officers can post this way: people whose Discord roles can @everyone, manage messages or
 * manage the server, or who have one of the roles listed in POSTER_ROLES.
 *
 * It also DMs members, every five minutes at most (see "Direct messages" below):
 *   - when someone assigns them a task in the portal, and
 *   - when they've been clocked in longer than the portal's "Longest session without approval"
 *     (Admin → Settings), which usually means they forgot to clock out.
 * It finds each member by the Discord username on their portal profile.
 *
 * Setup (SETUP.md, step 8): paste this file and appsscript.json into a new Apps Script project,
 * add the script properties below, then run setup() once.
 *
 * Script properties (Project Settings → Script properties):
 *   DISCORD_BOT_TOKEN    required. Discord developer portal → your app → Bot → Reset Token.
 *   FIREBASE_PROJECT_ID  required. Firebase → Project settings → Project ID, e.g. er-portal-19d4a.
 *   DISCORD_GUILD_ID     only if the bot is in more than one Discord server.
 *   DISCORD_CHANNELS     optional. Channel names or IDs to watch, separated by commas.
 *                        Default: every text channel the bot can see.
 *   POSTER_ROLES         optional. Role names or IDs that may post, separated by commas.
 *                        When set, only these roles (and server admins) can post.
 *   PORTAL_URL           optional. The portal's address for links in DMs.
 *                        Default: https://engineeringrenaissance.org/portal/
 *   DIRECT_MESSAGES      optional. Set to off to stop the DMs.
 *
 * Functions to run from the editor: setup() once, checkSetup() to see what the bot sees, stop()
 * to turn it off. poll() is what the one-minute trigger runs.
 */

var API = 'https://discord.com/api/v10';
var FIRESTORE = 'https://firestore.googleapis.com/v1';
var TZ = 'America/Los_Angeles';
var SCAN = 50;                // how many recent messages a re-check reads per channel
var RESCAN_EVERY_MIN = 10;    // edits and deletions are picked up within this many minutes
var KEEP_DAYS = 14;           // posts older than this are no longer kept in sync
var EMOJI_POSTED = '✅';
var EMOJI_NOT_ALLOWED = '🚫';
var PERM = { ADMINISTRATOR: 3, MANAGE_GUILD: 5, MANAGE_MESSAGES: 13, MENTION_EVERYONE: 17 };
var FIELDS = ['title', 'body', 'subteams', 'source', 'authorUid', 'authorName', 'authorPhoto', 'createdAt', 'updatedAt', 'discord'];

// ───────── Entry points ─────────

/** Run once from the editor: checks everything, then checks Discord every minute. */
function setup() {
  var report = checkSetup();
  stop_();
  ScriptApp.newTrigger('poll').timeBased().everyMinutes(1).create();
  console.log(report + '\n\nAll set. The bot now checks Discord every minute. Post a message that mentions the bot (and a subteam role, or @everyone) to try it.');
}

/** Shows what the bot can see and how Discord roles map to portal subteams. Changes nothing in Discord. */
function checkSetup() {
  var cfg = config_();
  var ctx = context_(cfg);
  var lines = ['Bot: @' + ctx.bot.name + ' in the "' + ctx.guild().name + '" server.'];
  var teams;
  try { teams = ctx.teams(); } catch (e) { throw new Error(firestoreHelp_(e, cfg)); }
  lines.push('Portal: ' + teams.subteams.length + ' subteams and ' + teams.subsidiaries.length + ' subsidiaries in Firebase project ' + cfg.project + '.');
  var linked = {};
  ctx.roles().forEach(function (r) {
    if (r.id === ctx.guildId || r.managed) return;
    var ids = teamsForRole_(r, teams);
    if (!ids.length) return;
    ids.forEach(function (id) { linked[id] = true; });
    lines.push('  @' + r.name + ' → ' + ids.map(function (id) { return teamName_(id, teams); }).join(', '));
  });
  var unlinked = teams.subteams.filter(function (t) { return !linked[t.id]; });
  if (unlinked.length) lines.push('Not linked to a Discord role yet: ' + unlinked.map(function (t) { return teamName_(t.id, teams); }).join(', ') + '. Link them in the portal under Admin → Subsidiaries and subteams.');
  var channels = watchedChannels_(cfg, ctx);
  lines.push('Watching ' + channels.length + ' channels: ' + channels.map(function (c) { return '#' + c.name; }).join(', ') + '.');
  if (cfg.directMessages) {
    var active = listDocs_(cfg, 'users').filter(function (u) { return u.status === 'active'; });
    var linkedPeople = active.filter(function (u) { return discordHandle_(u.discord); });
    lines.push('DMs: ' + linkedPeople.length + ' of ' + active.length + ' active members have a Discord username on their portal profile. '
      + 'They get a DM when someone assigns them a task, and when they’re clocked in for more than ' + sessionLimitHours_(cfg) + ' hours.');
    try { discord_(cfg, 'get', '/guilds/' + ctx.guildId + '/members/search?query=' + encodeURIComponent(ctx.bot.name) + '&limit=1'); }
    catch (e) {
      if (e.status !== 403) throw e;
      lines.push('Discord won’t let the bot look members up, so DMs can’t go out. Turn on Server Members Intent: Discord developer portal → your app → Bot → Privileged Gateway Intents.');
    }
  } else {
    lines.push('DMs are off (the DIRECT_MESSAGES script property).');
  }
  // Start from now: posts from before setup aren't copied.
  var props = PropertiesService.getScriptProperties();
  channels.forEach(function (c) {
    if (!props.getProperty('ch_' + c.id)) props.setProperty('ch_' + c.id, JSON.stringify({ last: c.last_message_id || '0', tracked: {} }));
  });
  var text = lines.join('\n');
  console.log(text);
  return text;
}

/** Turns the bot off. Announcements already in the portal stay. */
function stop() { stop_(); console.log('Stopped. Run setup() to start again.'); }

/** What the one-minute trigger runs. */
function poll() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // the previous run is still going
  try { return run_({}); }
  catch (e) {
    if (e.rateLimited) { console.warn(e.message + '. Trying again next minute.'); return []; }
    throw e;
  } finally { lock.releaseLock(); }
}

function stop_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'poll') ScriptApp.deleteTrigger(t); });
}

// ───────── One run ─────────

function run_(opts) {
  var cfg = config_();
  var ctx = context_(cfg);
  var props = PropertiesService.getScriptProperties();
  var log = [];
  if (opts.dms !== false && cfg.directMessages) {
    try { directMessages_(cfg, ctx, props, Date.now(), log); }
    catch (e) { if (e.rateLimited) throw e; console.warn('Skipped the DMs this time: ' + e.message); }
  }
  var channels = watchedChannels_(cfg, ctx);
  var recheck = opts.recheck !== undefined ? opts.recheck : new Date().getMinutes() % RESCAN_EVERY_MIN === 0;
  var work = [];
  channels.forEach(function (ch) {
    var key = 'ch_' + ch.id;
    var raw = props.getProperty(key);
    if (!raw) { props.setProperty(key, JSON.stringify({ last: ch.last_message_id || '0', tracked: {} })); return; }
    var st = JSON.parse(raw);
    var fresh = !!ch.last_message_id && snowCmp_(ch.last_message_id, st.last) > 0;
    var again = recheck && Object.keys(st.tracked).length > 0;
    if (fresh || again) work.push({ ch: ch, st: st, key: key, full: again });
  });
  if (!work.length) { log.forEach(function (line) { console.log(line); }); return log; }

  var requests = work.map(function (w) {
    var query = w.full ? 'limit=' + SCAN : 'after=' + w.st.last + '&limit=100';
    return Object.assign({ url: API + '/channels/' + w.ch.id + '/messages?' + query }, discordRequest_(cfg, 'get'));
  });
  var responses = UrlFetchApp.fetchAll(requests);
  work.forEach(function (w, i) {
    var messages;
    try { messages = parse_(responses[i], 'Reading #' + w.ch.name); }
    catch (e) {
      if (e.status === 403 || e.status === 404) { CacheService.getScriptCache().put('noaccess_' + w.ch.id, '1', 3600); return; }
      throw e;
    }
    handleChannel_(cfg, ctx, w, messages || [], log);
    props.setProperty(w.key, JSON.stringify(w.st));
  });
  log.forEach(function (line) { console.log(line); });
  return log;
}

function handleChannel_(cfg, ctx, w, messages, log) {
  var st = w.st;
  var sorted = messages.slice().sort(function (a, b) { return snowCmp_(a.id, b.id); });
  var seen = {};
  sorted.forEach(function (m) {
    seen[m.id] = true;
    if (snowCmp_(m.id, st.last) > 0) st.last = m.id;
    handleMessage_(cfg, ctx, w.ch, st, m, log);
  });
  if (w.full) {
    // A post the bot copied that's gone from the channel was deleted in Discord.
    var oldest = sorted.length ? sorted[0].id : null;
    var wholeChannel = sorted.length < SCAN;
    Object.keys(st.tracked).forEach(function (id) {
      if (seen[id]) return;
      if (wholeChannel || (oldest && snowCmp_(id, oldest) >= 0)) {
        if (st.tracked[id].p) { unpublish_(cfg, id); log.push('Took down a post from #' + w.ch.name + ': it was deleted in Discord.'); }
        delete st.tracked[id];
      }
    });
  }
  var cutoff = Date.now() - KEEP_DAYS * 86400000;
  Object.keys(st.tracked).forEach(function (id) { if (snowTime_(id) < cutoff) delete st.tracked[id]; });
}

function handleMessage_(cfg, ctx, ch, st, m, log) {
  if (!m || (m.author && m.author.bot) || (m.type !== 0 && m.type !== 19)) return;
  var roles = m.mention_roles || [];
  var mentioned = (m.mentions || []).some(function (u) { return u.id === ctx.bot.id; })
    || (roles.length > 0 && !!ctx.botRoleId() && roles.indexOf(ctx.botRoleId()) >= 0);
  var prev = st.tracked[m.id];
  var version = m.edited_timestamp || m.timestamp;

  if (!mentioned) {
    if (prev) {
      if (prev.p) { unpublish_(cfg, m.id); log.push('Took down a post from #' + ch.name + ': it no longer mentions the bot.'); }
      delete st.tracked[m.id];
    }
    return;
  }
  if (prev && prev.v === version) return; // already handled this version

  var member = ctx.member(m.author.id);
  var name = displayName_(m.author, member);
  if (!canPost_(cfg, ctx, member)) {
    if (!prev) react_(cfg, ch.id, m.id, EMOJI_NOT_ALLOWED);
    if (prev && prev.p) unpublish_(cfg, m.id);
    st.tracked[m.id] = { v: version, p: false, e: 'perm' };
    log.push('Didn’t post ' + name + '’s message in #' + ch.name + ': only officers can post to the portal.');
    return;
  }

  var aud = audience_(m, ctx);
  if (aud.problem) {
    if (!prev || prev.e !== 'role') reply_(cfg, ch.id, m.id, aud.problem);
    if (prev && prev.p) unpublish_(cfg, m.id);
    st.tracked[m.id] = { v: version, p: false, e: 'role' };
    log.push('Didn’t post ' + name + '’s message in #' + ch.name + ': ' + aud.unknown.join(', ') + ' isn’t linked to a subteam.');
    return;
  }

  var post = toAnnouncement_(m, ch, ctx, member, aud);
  publish_(cfg, m.id, post);
  var forWhom = aud.subteams.length ? 'for ' + aud.subteams.map(function (id) { return teamName_(id, ctx.teams()); }).join(', ') : 'for everyone';
  if (!prev || !prev.p) {
    react_(cfg, ch.id, m.id, EMOJI_POSTED);
    audit_(cfg, 'Posted “' + post.title + '” from #' + ch.name + ' ' + forWhom + ' (sent by ' + name + ')', 'discord-' + m.id);
    log.push('Posted “' + post.title + '” from #' + ch.name + ' ' + forWhom + '.');
  } else {
    log.push('Updated “' + post.title + '” after an edit in #' + ch.name + '.');
  }
  st.tracked[m.id] = { v: version, p: true };
}

// ───────── Who it's for ─────────

function audience_(m, ctx) {
  var everyone = !!m.mention_everyone || /(^|\s)@(everyone|here)\b/.test(m.content || '');
  if (everyone) return { subteams: [], unknown: [] };
  var botRole = ctx.botRoleId();
  var teams = null;
  var subteams = [], unknown = [];
  (m.mention_roles || []).forEach(function (id) {
    if (id === botRole) return;
    teams = teams || ctx.teams();
    var role = ctx.roleById(id) || { id: id, name: id };
    var ids = teamsForRole_(role, teams);
    if (ids.length) ids.forEach(function (x) { subteams.push(x); });
    else unknown.push('@' + role.name);
  });
  subteams = unique_(subteams);
  if (!subteams.length && unknown.length) {
    return {
      unknown: unknown,
      problem: 'Not posted to the portal: ' + unknown.join(', ') + (unknown.length === 1 ? ' isn’t' : ' aren’t') +
        ' linked to a portal subteam yet. An admin can link it in the portal under Admin → Subsidiaries and subteams, then edit your message to try again.',
    };
  }
  return { subteams: subteams, unknown: unknown };
}

// The portal subteams a Discord role stands for. A subteam or subsidiary is linked by putting the
// role's name or ID in its "Discord role" field; one with that field blank matches a role with
// the same name, as long as only one does.
function teamsForRole_(role, teams) {
  var matches = function (item) {
    var ref = String(item.discordRole || '').trim().replace(/^@/, '');
    return !!ref && (ref === role.id || norm_(ref) === norm_(role.name));
  };
  var ids = teams.subteams.filter(matches).map(function (t) { return t.id; });
  teams.subsidiaries.filter(matches).forEach(function (s) {
    teams.subteams.forEach(function (t) { if (t.subsidiaryId === s.id) ids.push(t.id); });
  });
  if (!ids.length) {
    var named = teams.subteams.filter(function (t) { return !t.discordRole && norm_(t.name) === norm_(role.name); });
    if (named.length === 1) ids.push(named[0].id);
    else if (!named.length) {
      var namedSub = teams.subsidiaries.filter(function (s) { return !s.discordRole && norm_(s.name) === norm_(role.name); });
      if (namedSub.length === 1) teams.subteams.forEach(function (t) { if (t.subsidiaryId === namedSub[0].id) ids.push(t.id); });
    }
  }
  return unique_(ids);
}

function canPost_(cfg, ctx, member) {
  if (!member || !member.user) return false;
  if (ctx.guild().owner_id === member.user.id) return true;
  var mine = ctx.roles().filter(function (r) { return r.id === ctx.guildId || (member.roles || []).indexOf(r.id) >= 0; });
  if (mine.some(function (r) { return hasBit_(r.permissions, PERM.ADMINISTRATOR); })) return true;
  if (cfg.posterRoles.length) {
    return mine.some(function (r) { return cfg.posterRoles.some(function (x) { return x === r.id || norm_(x) === norm_(r.name); }); });
  }
  return mine.some(function (r) {
    return hasBit_(r.permissions, PERM.MANAGE_GUILD) || hasBit_(r.permissions, PERM.MANAGE_MESSAGES) || hasBit_(r.permissions, PERM.MENTION_EVERYONE);
  });
}

// ───────── Turning a Discord post into an announcement ─────────

function toAnnouncement_(m, ch, ctx, member, aud) {
  var text = cleanText_(m.content || '', m, ctx);
  var parts = text ? splitTitle_(text) : { title: 'New post in #' + ch.name, body: '' };
  var attachments = (m.attachments || []).length;
  return {
    title: parts.title,
    body: clip_(parts.body, 8000),
    subteams: aud.subteams,
    source: 'discord',
    authorUid: null,
    authorName: displayName_(m.author, member),
    authorPhoto: avatarUrl_(m.author, member, ctx.guildId),
    createdAt: new Date(m.timestamp),
    updatedAt: new Date(m.edited_timestamp || m.timestamp),
    discord: {
      messageId: m.id, channelId: ch.id, channelName: ch.name, guildId: ctx.guildId, attachments: attachments,
      url: 'https://discord.com/channels/' + ctx.guildId + '/' + ch.id + '/' + m.id,
    },
  };
}

function cleanText_(content, m, ctx) {
  var s = String(content);
  // The bot, role and @everyone mentions at the very start or end ("@Portal @Chassis …") say who
  // it's for, so they're dropped. Mentions of people stay, as names.
  var who = '(?:<@!?' + ctx.bot.id + '>|<@&\\d+>|@everyone|@here)';
  s = s.replace(new RegExp('^(?:\\s*' + who + '[\\s,]*)+'), '')
    .replace(new RegExp('(?:[\\s,]*' + who + '\\s*)+$'), '');
  s = s.replace(/<@!?(\d+)>/g, function (all, id) { return id === ctx.bot.id ? '' : '@' + userName_(m, id); })
    .replace(/<@&(\d+)>/g, function (all, id) { var r = ctx.roleById(id); return '@' + (r ? r.name : 'role'); })
    .replace(/(^|\s)@(everyone|here)\b/g, '$1')
    .replace(/<#(\d+)>/g, function (all, id) { return '#' + (ctx.channelNames[id] || 'channel'); })
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/<t:(-?\d+)(?::[tTdDfFR])?>/g, function (all, sec) { return Utilities.formatDate(new Date(Number(sec) * 1000), TZ, 'EEE, MMM d, h:mm a'); })
    .replace(/<(https?:\/\/[^\s>]+)>/g, '$1');
  return discordMarkdown_(s).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Discord formatting → the portal's short list: **bold**, *italic*, `code`, links and "- " lists.
function discordMarkdown_(s) {
  var out = [];
  var inCode = false;
  s.split('\n').forEach(function (line) {
    if (/^\s*```/.test(line)) { inCode = !inCode; return; }
    if (inCode) { out.push(line); return; }
    out.push(line
      .replace(/^\s*-#\s+/, '')
      .replace(/^\s*>>>\s?/, '').replace(/^\s*>\s?/, '')
      .replace(/^\s*#{1,3}\s+(.+)$/, function (all, t) { return '**' + t.replace(/\*\*/g, '').trim() + '**'; })
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/~~([^~\n]+)~~/g, '$1')
      .replace(/\|\|([^|\n]+)\|\|/g, '$1')
      .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1*$2*')
      .replace(/^(\s*)\*\s+/, '$1- '));
  });
  // The portal renders a list only when it stands in its own paragraph.
  var item = function (l) { return /^\s*(?:[-•]|\d+[.)])\s+/.test(l); };
  var spaced = [];
  out.forEach(function (line, i) {
    if (i > 0 && line.trim() && out[i - 1].trim() && item(line) !== item(out[i - 1])) spaced.push('');
    spaced.push(line);
  });
  return spaced.join('\n');
}

// A short first line becomes the title. One long paragraph keeps its first sentence as the title.
function splitTitle_(text) {
  var lines = text.split('\n');
  var first = lines[0].trim();
  var rest = lines.slice(1).join('\n').trim();
  var plain = function (x) { return x.replace(/\*\*|\*/g, '').trim(); };
  if (first.length <= 100) return { title: clip_(plain(first).replace(/:$/, ''), 160), body: rest };
  var sentence = /^(.{10,110}?[.!?])(\s|$)/.exec(plain(first));
  return { title: clip_(sentence ? sentence[1] : plain(first), 110), body: text };
}

function displayName_(user, member) {
  return (member && member.nick) || user.global_name || user.username || 'Someone';
}

function userName_(m, id) {
  var u = (m.mentions || []).filter(function (x) { return x.id === id; })[0];
  return u ? (u.global_name || u.username) : 'someone';
}

function avatarUrl_(user, member, guildId) {
  if (member && member.avatar) return 'https://cdn.discordapp.com/guilds/' + guildId + '/users/' + user.id + '/avatars/' + member.avatar + '.png?size=128';
  if (user.avatar) return 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=128';
  return null;
}

// ───────── Discord ─────────

function discordRequest_(cfg, method, body) {
  var req = { method: method, headers: { Authorization: 'Bot ' + cfg.token }, muteHttpExceptions: true };
  if (body !== undefined) { req.contentType = 'application/json'; req.payload = JSON.stringify(body); }
  return req;
}

function discord_(cfg, method, path, body) {
  var what = 'Discord ' + method.toUpperCase() + ' ' + path.split('?')[0];
  for (var attempt = 0; ; attempt++) {
    try { return parse_(UrlFetchApp.fetch(API + path, discordRequest_(cfg, method, body)), what); }
    catch (e) {
      // A short rate limit (common on reactions) is worth one wait; anything longer waits for the next run.
      if (e.rateLimited && attempt === 0 && e.retryAfter <= 2) { Utilities.sleep(Math.ceil(e.retryAfter * 1000) + 50); continue; }
      throw e;
    }
  }
}

function react_(cfg, channelId, messageId, emoji) {
  try { discord_(cfg, 'put', '/channels/' + channelId + '/messages/' + messageId + '/reactions/' + encodeURIComponent(emoji) + '/@me'); }
  catch (e) { console.warn('Couldn’t add the ' + emoji + ' reaction: ' + e.message); }
}

function reply_(cfg, channelId, messageId, text) {
  try {
    discord_(cfg, 'post', '/channels/' + channelId + '/messages', {
      content: text,
      message_reference: { message_id: messageId, fail_if_not_exists: false },
      allowed_mentions: { parse: [], replied_user: false },
    });
  } catch (e) { console.warn('Couldn’t reply in Discord: ' + e.message); }
}

function context_(cfg) {
  var cache = CacheService.getScriptCache();
  var cached = function (key, seconds, load) {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
    var value = load();
    try { cache.put(key, JSON.stringify(value), seconds); } catch (e) { /* too big to cache; fine */ }
    return value;
  };
  var bot = cached('bot', 21600, function () { var me = discord_(cfg, 'get', '/users/@me'); return { id: me.id, name: me.username }; });
  var guildId = cfg.guildId || guildId_(cfg);
  var roles = null, guild = null, teams = null, members = {};
  var ctx = {
    bot: bot,
    guildId: guildId,
    channelNames: {},
    roles: function () { return roles || (roles = cached('roles_' + guildId, 600, function () { return discord_(cfg, 'get', '/guilds/' + guildId + '/roles'); })); },
    guild: function () {
      return guild || (guild = cached('guild_' + guildId, 3600, function () {
        var g = discord_(cfg, 'get', '/guilds/' + guildId);
        return { id: g.id, name: g.name, owner_id: g.owner_id };
      }));
    },
    teams: function () {
      return teams || (teams = {
        subteams: listDocs_(cfg, 'subteams').filter(function (t) { return !t.archived; }),
        subsidiaries: listDocs_(cfg, 'subsidiaries'),
      });
    },
    member: function (uid) {
      if (!(uid in members)) {
        try { members[uid] = discord_(cfg, 'get', '/guilds/' + guildId + '/members/' + uid); }
        catch (e) { if (e.rateLimited) throw e; members[uid] = null; }
      }
      return members[uid];
    },
    roleById: function (id) { return ctx.roles().filter(function (r) { return r.id === id; })[0] || null; },
    // The role Discord gives the bot itself, in case someone picks it instead of the bot.
    botRoleId: function () {
      var r = ctx.roles().filter(function (x) { return x.tags && x.tags.bot_id === bot.id; })[0];
      return r ? r.id : null;
    },
  };
  return ctx;
}

function guildId_(cfg) {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('GUILD_ID_FOUND');
  if (saved) return saved;
  var guilds = discord_(cfg, 'get', '/users/@me/guilds');
  if (guilds.length !== 1) {
    throw new Error(guilds.length
      ? 'The bot is in ' + guilds.length + ' Discord servers (' + guilds.map(function (g) { return g.name + ': ' + g.id; }).join(', ') + '). Add DISCORD_GUILD_ID with the right one.'
      : 'The bot isn’t in a Discord server yet. Invite it with the link from SETUP.md, step 8.');
  }
  props.setProperty('GUILD_ID_FOUND', guilds[0].id);
  return guilds[0].id;
}

function watchedChannels_(cfg, ctx) {
  var cache = CacheService.getScriptCache();
  var all = discord_(cfg, 'get', '/guilds/' + ctx.guildId + '/channels');
  all.forEach(function (c) { ctx.channelNames[c.id] = c.name; });
  return all.filter(function (c) {
    return (c.type === 0 || c.type === 5)
      && (!cfg.channels.length || cfg.channels.some(function (x) { return x === c.id || norm_(x) === norm_(c.name); }))
      && !cache.get('noaccess_' + c.id);
  });
}

// ───────── Direct messages: new tasks and long clock-ins ─────────
// Every five minutes the bot DMs people about two things in the portal:
//   - a task that was just assigned to them: once per task and person, and again only if they're taken
//     off it and put back on. Assigning yourself sends nothing.
//   - a clock-in that has run longer than the portal's "Longest session without approval" (Admin →
//     Settings, 10 hours unless an admin changed it): once per session.
// It finds each person by the Discord username on their portal profile. People with no username there,
// who aren't in the server, or whose Discord settings block DMs from server members are skipped, and
// the run log says who and why.

var DM_EVERY_MIN = 5;   // how often the DM checks run
var DM_TASK_DAYS = 3;   // a task last changed longer ago than this is old news: no DM

function directMessages_(cfg, ctx, props, now, log) {
  if (now - Number(props.getProperty('DM_LAST') || 0) < DM_EVERY_MIN * 60000 - 20000) return;
  props.setProperty('DM_LAST', String(now));
  var dm = dmSender_(cfg, ctx, log);
  longSessions_(cfg, dm, props, now);
  newTasks_(cfg, dm, props, now);
}

// Sends a DM to a portal member. Returns 'sent', 'skipped' (won't work until something changes, so
// don't try again) or 'later' (worth another try next time).
function dmSender_(cfg, ctx, log) {
  var users = null, cache = CacheService.getScriptCache();
  return {
    send: function (uid, text, about) {
      if (!users) { users = {}; listDocs_(cfg, 'users').forEach(function (u) { users[u.id] = u; }); }
      var u = users[uid] || {}, name = u.name || 'A member', handle = discordHandle_(u.discord);
      var skip = function (why) { log.push('No DM to ' + name + ' about ' + about + ': ' + why + '.'); return 'skipped'; };
      if (!handle) return skip('no Discord username on their portal profile');
      var id;
      try { id = discordUserId_(cfg, ctx, handle); }
      catch (e) { if (e.rateLimited) throw e; console.warn('Couldn’t look up @' + handle + ' in Discord: ' + e.message); return 'later'; }
      if (!id) return skip('nobody in the Discord server goes by @' + handle);
      try {
        var channel = cache.get('dm_' + id);
        if (!channel) { channel = discord_(cfg, 'post', '/users/@me/channels', { recipient_id: id }).id; cache.put('dm_' + id, channel, 21600); }
        discord_(cfg, 'post', '/channels/' + channel + '/messages', { content: text, allowed_mentions: { parse: [] } });
      } catch (e) {
        if (e.rateLimited) throw e;
        if (e.status === 403) return skip('their Discord settings block DMs from server members');
        console.warn('Couldn’t DM ' + name + ': ' + e.message);
        return 'later';
      }
      log.push('DM to ' + name + ' (@' + handle + ') about ' + about + '.');
      return 'sent';
    },
  };
}

// What someone typed as their Discord username → what to look for: '@Sofia_R ' → 'sofia_r'.
// Old-style names keep just the part before the #1234 tag.
function discordHandle_(raw) {
  return String(raw || '').trim().replace(/^@/, '').replace(/#\d{1,4}$/, '').trim().toLowerCase();
}

// The server member with that username, or else the one member with that display name or nickname.
// Remembered for six hours (an hour when nobody matched).
function discordUserId_(cfg, ctx, handle) {
  var cache = CacheService.getScriptCache(), key = 'du_' + handle.slice(0, 200), hit = cache.get(key);
  if (hit) return hit === '-' ? null : hit;
  var found = discord_(cfg, 'get', '/guilds/' + ctx.guildId + '/members/search?query=' + encodeURIComponent(handle) + '&limit=25') || [];
  var same = function (v) { return !!v && String(v).toLowerCase() === handle; };
  var match = found.filter(function (m) { return m.user && same(m.user.username); });
  if (!match.length) match = found.filter(function (m) { return m.user && (same(m.nick) || same(m.user.global_name)); });
  var id = match.length === 1 ? match[0].user.id : null;
  cache.put(key, id || '-', id ? 21600 : 3600);
  return id;
}

// Everyone still clocked in past the limit gets one DM for that session.
function longSessions_(cfg, dm, props, now) {
  var hours = sessionLimitHours_(cfg);
  var told = JSON.parse(props.getProperty('DM_LONG') || '{}'), keep = {};
  listDocs_(cfg, 'presence').forEach(function (p) {
    var start = p.start instanceof Date ? p.start.getTime() : NaN;
    if (!p.uid || !p.entryId || !(now - start > hours * 3600000)) return;
    if (told[p.entryId]) { keep[p.entryId] = 1; return; }
    var text = 'You’ve been clocked in to the portal for more than ' + hours + ' hours, since '
      + Utilities.formatDate(new Date(start), TZ, 'EEE h:mm a') + '. If you’ve left, open the portal, clock out and '
      + 'say when you actually left. Sessions this long need a lead’s OK: ' + cfg.portalUrl;
    if (dm.send(p.uid, text, 'a ' + Math.floor((now - start) / 3600000) + '-hour clock-in') !== 'later') keep[p.entryId] = 1;
  });
  props.setProperty('DM_LONG', JSON.stringify(keep));
}

function sessionLimitHours_(cfg) {
  try {
    var h = Number(fsDoc_(firestore_(cfg, 'get', 'config/settings')).maxSessionHours);
    return h > 0 ? h : 10;
  } catch (e) {
    if (e.status === 404) return 10; // no settings saved yet: the portal's default
    throw e;
  }
}

// Who has heard about each task lives in a script property, dmt_<task id>: a comma-separated list of
// portal user ids. The first run only takes note of who's assigned what, so nobody gets DMs about
// tasks from before the bot started sending them.
function newTasks_(cfg, dm, props, now) {
  var first = !props.getProperty('DM_TASKS_SINCE');
  var all = props.getProperties(), keep = {}, spaces = null;
  allTasks_(cfg).forEach(function (t) {
    var key = 'dmt_' + t.id;
    var updated = t.updatedAt instanceof Date ? t.updatedAt.getTime() : 0;
    var assignees = (t.assignees || []).filter(Boolean);
    if (t.status === 'done') { if (now - updated < 30 * 86400000) keep[key] = true; return; } // reopened soon after: no repeat
    if (!assignees.length) return;
    keep[key] = true;
    var told = (all[key] || '').split(',').filter(function (uid) { return assignees.indexOf(uid) >= 0; });
    var recent = now - updated <= DM_TASK_DAYS * 86400000;
    assignees.filter(function (uid) { return told.indexOf(uid) < 0; }).forEach(function (uid) {
      if (first || !recent || uid === t.createdBy) { told.push(uid); return; }
      if (!spaces) { spaces = {}; listDocs_(cfg, 'spaces').forEach(function (sp) { spaces[sp.id] = sp; }); }
      var space = spaces[t.spaceId];
      var about = [space && space.name ? '#' + space.name : '', t.due ? 'due ' + dueDate_(t.due) : '',
        t.priority === 'high' ? 'high priority' : ''].filter(Boolean);
      var text = 'You have a new task on the portal: **' + clip_(t.title || 'Untitled', 200) + '**'
        + (about.length ? ' (' + about.join(', ') + ')' : '') + '. Your tasks: ' + cfg.portalUrl + '#/tasks';
      if (dm.send(uid, text, 'the task "' + clip_(t.title || 'Untitled', 60) + '"') !== 'later') told.push(uid);
    });
    if (told.join(',') !== (all[key] || '')) props.setProperty(key, told.join(','));
  });
  Object.keys(all).forEach(function (k) { if (k.indexOf('dmt_') === 0 && !keep[k]) props.deleteProperty(k); });
  if (first) props.setProperty('DM_TASKS_SINCE', new Date(now).toISOString());
}

// Tasks live under each space (spaces/{id}/tasks), so one query asks for every collection named tasks.
// If Firestore refuses that, the bot reads space by space instead.
function allTasks_(cfg) {
  try {
    var rows = firestore_(cfg, 'post', ':runQuery', { structuredQuery: { from: [{ collectionId: 'tasks', allDescendants: true }] } }) || [];
    return rows.filter(function (r) { return r.document; }).map(function (r) { return fsDoc_(r.document); });
  } catch (e) {
    if (e.status !== 400) throw e;
    var out = [];
    listDocs_(cfg, 'spaces').forEach(function (sp) {
      listDocs_(cfg, 'spaces/' + sp.id + '/tasks').forEach(function (t) { if (!t.spaceId) t.spaceId = sp.id; out.push(t); });
    });
    return out;
  }
}

// '2026-12-05' → 'Sat, Dec 5'
function dueDate_(ymd) {
  var d = new Date(String(ymd) + 'T12:00:00Z');
  return isNaN(d.getTime()) ? String(ymd) : Utilities.formatDate(d, TZ, 'EEE, MMM d');
}

// ───────── Firestore (the portal's database) ─────────
// Requests go out as the Google account running this script, so the portal's security rules
// don't apply; that account needs access to the Firebase project.

function firestore_(cfg, method, path, body) {
  var req = {
    method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': cfg.project },
  };
  if (body) { req.contentType = 'application/json'; req.payload = JSON.stringify(body); }
  var url = FIRESTORE + '/projects/' + cfg.project + '/databases/(default)/documents' + (path.charAt(0) === ':' ? '' : '/') + path;
  return parse_(UrlFetchApp.fetch(url, req), 'Firestore ' + method.toUpperCase() + ' ' + path.split('?')[0]);
}

function listDocs_(cfg, collection) {
  var out = [], token = '';
  do {
    var page = firestore_(cfg, 'get', collection + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : '')) || {};
    (page.documents || []).forEach(function (d) { out.push(fsDoc_(d)); });
    token = page.nextPageToken || '';
  } while (token);
  return out;
}

function publish_(cfg, messageId, post) {
  var mask = FIELDS.map(function (f) { return 'updateMask.fieldPaths=' + f; }).join('&');
  firestore_(cfg, 'patch', 'announcements/discord-' + messageId + '?' + mask, { fields: fsFields_(post) });
}

function unpublish_(cfg, messageId) {
  try { firestore_(cfg, 'delete', 'announcements/discord-' + messageId); }
  catch (e) { if (e.status !== 404) throw e; }
}

function audit_(cfg, summary, docId) {
  try {
    firestore_(cfg, 'post', 'audit', { fields: fsFields_({
      at: new Date(), actorUid: null, actorName: 'Discord bot', action: 'announcement.discord',
      summary: clip_(summary, 500), targetType: 'announcement', targetId: docId,
    }) });
  } catch (e) { console.warn('Audit log entry skipped: ' + e.message); }
}

function firestoreHelp_(e, cfg) {
  var text = String(e.message || e);
  if (/has not been used in project|SERVICE_DISABLED|disabled/i.test(text)) {
    return 'Google says the Firestore API isn’t turned on for this script’s project. In this Apps Script project open Project Settings → Google Cloud Platform (GCP) Project → Change project, and enter the project number from Firebase → Project settings. Details: ' + text;
  }
  if (e.status === 403 || e.status === 401) {
    return 'This Google account can’t reach the portal’s database in ' + cfg.project + '. Run the script as the account that owns the Firebase project, or add this account in Firebase → Project settings → Users and permissions. Details: ' + text;
  }
  if (e.status === 404) return 'No Firestore database found for project ' + cfg.project + '. Check FIREBASE_PROJECT_ID. Details: ' + text;
  return text;
}

function fsValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: v.length ? { values: v.map(fsValue_) } : {} };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'object') return { mapValue: { fields: fsFields_(v) } };
  throw new Error('Can’t store a ' + typeof v + ' in Firestore');
}

function fsFields_(obj) {
  var out = {};
  Object.keys(obj).forEach(function (k) { out[k] = fsValue_(obj[k]); });
  return out;
}

function fsPlain_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsPlain_);
  if ('mapValue' in v) {
    var o = {}, f = v.mapValue.fields || {};
    Object.keys(f).forEach(function (k) { o[k] = fsPlain_(f[k]); });
    return o;
  }
  return null;
}

function fsDoc_(d) {
  var o = { id: d.name.split('/').pop() }, f = d.fields || {};
  Object.keys(f).forEach(function (k) { o[k] = fsPlain_(f[k]); });
  return o;
}

// ───────── Small helpers ─────────

function config_() {
  var p = PropertiesService.getScriptProperties();
  var token = (p.getProperty('DISCORD_BOT_TOKEN') || '').trim();
  var project = (p.getProperty('FIREBASE_PROJECT_ID') || '').trim();
  if (!token) throw new Error('Add DISCORD_BOT_TOKEN under Project Settings → Script properties.');
  if (!project) throw new Error('Add FIREBASE_PROJECT_ID under Project Settings → Script properties.');
  return {
    token: token, project: project,
    guildId: (p.getProperty('DISCORD_GUILD_ID') || '').trim(),
    channels: list_(p.getProperty('DISCORD_CHANNELS')),
    posterRoles: list_(p.getProperty('POSTER_ROLES')),
    portalUrl: (p.getProperty('PORTAL_URL') || 'https://engineeringrenaissance.org/portal/').trim(),
    directMessages: !/^(off|no|false|0)$/i.test((p.getProperty('DIRECT_MESSAGES') || '').trim()),
  };
}

function parse_(res, what) {
  var code = res.getResponseCode();
  var text = res.getContentText() || '';
  if (code === 429) {
    var info = {};
    try { info = JSON.parse(text); } catch (e) { /* not JSON */ }
    var err = new Error(what + ' was rate limited by Discord');
    err.rateLimited = true; err.status = 429; err.retryAfter = Number(info.retry_after) || 5;
    throw err;
  }
  if (code >= 400) {
    var e2 = new Error(what + ' failed (' + code + '): ' + text.slice(0, 300));
    e2.status = code;
    throw e2;
  }
  return text ? JSON.parse(text) : null;
}

function list_(v) {
  return String(v || '').split(',').map(function (x) { return x.trim().replace(/^[#@]/, ''); }).filter(Boolean);
}

function norm_(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

function unique_(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

function clip_(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
}

function teamName_(id, teams) {
  var t = teams.subteams.filter(function (x) { return x.id === id; })[0];
  if (!t) return id;
  var sub = teams.subsidiaries.filter(function (s) { return s.id === t.subsidiaryId; })[0];
  return sub ? t.name + ' (' + sub.name + ')' : t.name;
}

// Discord ids ("snowflakes") are too big for JavaScript numbers; compare them as strings.
function snowCmp_(a, b) {
  a = String(a || '0'); b = String(b || '0');
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

function snowTime_(id) { return Math.floor(Number(id) / 4194304) + 1420070400000; }

// Discord permissions are a big number written as a decimal string; read one bit of it.
function hasBit_(perm, bit) {
  var digits = String(perm || '0').replace(/\D/g, '') || '0';
  for (var i = 0; i < bit; i++) digits = halve_(digits);
  return Number(digits.charAt(digits.length - 1)) % 2 === 1;
}

function halve_(digits) {
  var out = '', carry = 0;
  for (var i = 0; i < digits.length; i++) {
    var cur = carry * 10 + Number(digits.charAt(i));
    out += Math.floor(cur / 2);
    carry = cur % 2;
  }
  return out.replace(/^0+(?=\d)/, '');
}
