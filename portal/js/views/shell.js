// The signed-in portal: sidebar, mobile chrome, search palette and routes.
import { html, useState, useEffect, useRef, useMemo, Icon, Avatar, useNow, toastError } from '../lib/ui.js';
import { useStore, setState, getState, isLead, isAdmin, DEFAULT_SETTINGS, visibleSpaces, groupBySubsidiary, treeOf, spaceLabel } from '../lib/store.js';
import { useRoute, href, go } from '../lib/router.js';
import { clockParts } from '../lib/time.js';
import { nest } from '../data/tree.js';
import { DemoBar, setBrowserColor, SpaceIcon } from './common.js';
import { Home } from './home.js';
import { TimeView } from './time.js';
import { Reports } from './reports.js';
import { CalendarView } from './calendar.js';
import { Announcements } from './announcements.js';
import { MyTasks, Board } from './tasks.js';
import { Members, MemberProfile, EditProfile } from './members.js';
import { SpacesIndex, SpaceHome, PageView, openNewSpace } from './spaces.js';
import { Admin } from './admin.js';

const ROLE_LABEL = { admin: 'Admin', lead: 'Lead', member: 'Member' };

export function Portal() {
  const { api, profile, railOpen } = useStore((s) => ({ api: s.api, profile: s.profile, railOpen: s.railOpen }));
  const lead = isLead(profile), admin = isAdmin(profile);
  const route = useRoute();
  useEffect(() => { setBrowserColor('#111318'); return () => setBrowserColor(null); }, []);

  // Live club data every screen relies on.
  useEffect(() => {
    const offs = [
      api.watchSettings((s) => setState({ settingsSaved: !!s, settings: { ...DEFAULT_SETTINGS, ...(s || {}), locationCheck: { ...DEFAULT_SETTINGS.locationCheck, ...(s?.locationCheck || {}) } } }), (e) => toastError(e, 'Couldn’t load club settings.')),
      api.watchRefs(({ subteams, activities, spaces, subsidiaries }) => setState({
        subteams: subteams.filter((x) => !x.archived).sort(byOrder),
        activities: activities.sort(byOrder),
        spaces: spaces.sort(byOrder),
        subsidiaries: subsidiaries.sort(byOrder),
      }), (e) => toastError(e, 'Couldn’t load subteams and spaces.')),
      api.watchPresence((p) => setState({ presence: p })),
    ];
    if (lead) offs.push(api.watchPendingFixes((f) => setState({ pendingFixes: f })));
    if (admin) offs.push(api.watchPendingMembers((m) => setState({ pendingMembers: m })));
    return () => offs.forEach((f) => f && f());
  }, [api, profile.uid, lead, admin]);

  // Page outlines and Drive folders, for the spaces this person can open.
  const openable = useStore((s) => visibleSpaces(s).map((sp) => sp.id).join(','));
  useEffect(() => {
    const ids = openable ? openable.split(',') : [];
    const offs = ids.map((id) => api.watchSpaceContent(id,
      (c) => setState((st) => ({ contents: { ...st.contents, [id]: { tree: c?.tree || [], driveFolder: c?.driveFolder || null } } })),
      () => setState((st) => ({ contents: { ...st.contents, [id]: { tree: [], driveFolder: null, denied: true } } }))));
    return () => offs.forEach((f) => f && f());
  }, [api, openable]);

  // Close the drawer whenever the route changes.
  useEffect(() => { if (getState().railOpen) setState({ railOpen: false }); window.scrollTo(0, 0); }, [route.path]);

  const [View, props, title] = resolve(route, lead, admin);
  // The skip link moves focus without touching the hash, which the router owns.
  const skip = (e) => { e.preventDefault(); document.getElementById('content')?.focus(); };
  return html`<div class="app">
    <a class="skip-link" href="#content" onClick=${skip}>Skip to content</a>
    <${Rail} route=${route} />
    ${railOpen && html`<div class="scrim" onClick=${() => setState({ railOpen: false })}></div>`}
    <div class="main">
      <${DemoBar} />
      <${Topbar} title=${title} />
      <main id="content" tabindex="-1"><${View} ...${props} key=${route.path} /></main>
    </div>
    <${Tabbar} route=${route} />
    <${Palette} />
  </div>`;
}

const byOrder = (a, b) => (a.order ?? 99) - (b.order ?? 99) || String(a.name).localeCompare(String(b.name));

function resolve(route, lead, admin) {
  const [a, b, c] = route.parts;
  switch (a) {
    case undefined: return [Home, {}, 'Home'];
    case 'time': return [TimeView, { tab: b || 'mine' }, 'My time'];
    case 'reports': return lead ? [Reports, {}, 'Reports'] : [TimeView, { tab: 'mine' }, 'My time'];
    case 'calendar': return [CalendarView, {}, 'Calendar'];
    case 'announcements': return [Announcements, {}, 'Announcements'];
    case 'tasks': return [MyTasks, {}, 'Tasks'];
    case 'members': return b ? [MemberProfile, { uid: b }, 'Member'] : [Members, {}, 'Members'];
    case 'profile': return [EditProfile, {}, 'Your profile'];
    case 'spaces': return [SpacesIndex, {}, 'Spaces'];
    case 's': return c === 'board' ? [Board, { spaceId: b }, 'Task board'] : [SpaceHome, { spaceId: b }, 'Space'];
    case 'p': return [PageView, { pageId: b }, 'Page'];
    case 'admin': return admin ? [Admin, { tab: b || 'members' }, 'Admin'] : [NotFound, {}, 'Not found'];
    default: return [NotFound, {}, 'Not found'];
  }
}

function NotFound() {
  return html`<div class="content"><div class="empty"><h3>That page doesn’t exist</h3><p>It may have been moved or deleted, or you might not have access.</p>
    <a class="btn btn-primary" href="#/">Go home</a></div></div>`;
}

// ── Sidebar ──
function useMyPresence() {
  return useStore((s) => s.presence.find((p) => p.uid === s.profile?.uid) || null);
}

function RailClock() {
  const mine = useMyPresence();
  const maxH = useStore((s) => s.settings.maxSessionHours || 10);
  const now = useNow(1000, !!mine);
  if (mine && now - new Date(mine.start) > maxH * 3600e3) {
    return html`<a class="rail-clock" href="#/" style="border-color:rgba(242,184,92,.5)"><${Icon} name="alert" size=${18} style="color:#F2B85C" />
      <span><span class="label">Forgot to clock out?</span><span class="value" style="font-size:14px;font-family:var(--font-ui)">Fix it on Home</span></span></a>`;
  }
  if (!mine) {
    return html`<a class="rail-clock" href="#/"><span class="dot"></span><span><span class="label">Not clocked in</span><span class="value" style="font-size:14px;font-family:var(--font-ui)">Clock in on Home</span></span></a>`;
  }
  return html`<a class="rail-clock on" href="#/" aria-label="You are clocked in. Open Home to clock out."><span class="dot live"></span>
    <span><span class="label">Clocked in</span><span class="value">${clockParts(now - new Date(mine.start)).text}</span></span></a>`;
}

function NavLink({ to, icon, label, route, count }) {
  const current = to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(to + '/');
  return html`<a href=${href(to)} aria-current=${current ? 'page' : undefined}><${Icon} name=${icon} />${label}${count ? html`<span class="count" aria-label=${count + ' waiting'}>${count}</span>` : null}</a>`;
}

function readOpen() { try { return JSON.parse(localStorage.getItem('er-tree-open') || '{}'); } catch { return {}; } }

function Rail({ route }) {
  const { profile, railOpen, pendingFixes, pendingMembers, subsidiaries } = useStore((s) => ({ profile: s.profile, railOpen: s.railOpen, pendingFixes: s.pendingFixes, pendingMembers: s.pendingMembers, subsidiaries: s.subsidiaries }));
  const spaces = useStore((s) => visibleSpaces(s));
  const [open, setOpen] = useState(readOpen);
  const toggle = (id, value) => { const next = { ...open, [id]: value }; setOpen(next); try { localStorage.setItem('er-tree-open', JSON.stringify(next)); } catch { /* ignore */ } };
  const lead = isLead(profile), admin = isAdmin(profile);
  const groups = groupBySubsidiary(spaces, subsidiaries).filter((g) => g.items.length || (admin && g.sub));
  const rowProps = { route, open, toggle };

  return html`<nav class=${'rail' + (railOpen ? ' open' : '')} aria-label="Portal">
    <a class="wordmark" href="#/"><img src="assets/mark.png" alt="" /><span><b>Engineering Renaissance</b><small>Member portal</small></span></a>
    <${RailClock} />
    <div class="nav">
      <${NavLink} to="/" icon="home" label="Home" route=${route} />
      <${NavLink} to="/time" icon="clock" label="My time" route=${route} count=${lead ? pendingFixes.length : 0} />
      ${lead && html`<${NavLink} to="/reports" icon="chart" label="Reports" route=${route} />`}
      <${NavLink} to="/calendar" icon="calendar" label="Calendar" route=${route} />
      <${NavLink} to="/announcements" icon="megaphone" label="Announcements" route=${route} />
      <${NavLink} to="/tasks" icon="tasks" label="Tasks" route=${route} />
      <${NavLink} to="/members" icon="users" label="Members" route=${route} />
    </div>
    <div class="rail-group">
      <div class="rail-group-head"><a href="#/spaces">Spaces</a>
        <button onClick=${() => setState({ paletteOpen: true })} aria-label="Search pages"><${Icon} name="search" size=${15} /></button></div>
      <div class="tree">
        ${groups.map((g) => (g.sub
          ? html`<${SpaceGroup} key=${g.sub.id} sub=${g.sub} items=${g.items} admin=${admin} ...${rowProps} />`
          : g.items.map((sp) => html`<${SpaceRow} key=${sp.id} sp=${sp} ...${rowProps} />`)))}
        ${!spaces.length && !subsidiaries.length && html`<div class="tiny" style="padding:4px 10px;color:var(--rail-dim)">${admin ? 'Add spaces in Admin.' : 'No spaces yet.'}</div>`}
      </div>
    </div>
    <div class="rail-foot">
      ${admin && html`<div class="nav" style="margin-bottom:6px"><${NavLink} to="/admin" icon="shield" label="Admin" route=${route} count=${pendingMembers.length} /></div>`}
      <a class="rail-user" href="#/profile"><${Avatar} person=${profile} size=${32} />
        <span style="min-width:0"><b class="nowrap">${profile.name}</b><small>${profile.title || ROLE_LABEL[profile.role]}</small></span></a>
    </div>
  </nav>`;
}

// A subsidiary (Crush Depth, Prosthetic…) with its spaces under it, like a channel category.
// Folded up, it still shows the space you're in.
function SpaceGroup({ sub, items, admin, route, open, toggle }) {
  const key = 'g:' + sub.id;
  const isOpen = open[key] ?? true;
  const here = (sp) => (route.parts[0] === 's' && route.parts[1] === sp.id) || (route.parts[0] === 'p' && treeOf(sp.id).some((n) => n.id === route.parts[1]));
  const shown = isOpen ? items : items.filter(here);
  return html`<div class="space-group" role="group" aria-label=${sub.name}>
    <div class="group-head">
      <button class="group-toggle" aria-expanded=${String(isOpen)} onClick=${() => toggle(key, !isOpen)}><${Icon} name="chevronDown" /><span class="name">${sub.name}</span></button>
      ${admin && html`<button class="group-add" aria-label=${'New space in ' + sub.name} title=${'New space in ' + sub.name} onClick=${() => openNewSpace({ subsidiaryId: sub.id })}><${Icon} name="plus" size=${15} /></button>`}
    </div>
    ${shown.map((sp) => html`<${SpaceRow} key=${sp.id} sp=${sp} route=${route} open=${open} toggle=${toggle} />`)}
    ${isOpen && !items.length && html`<div class="tiny group-empty">No spaces yet.</div>`}
  </div>`;
}

function SpaceRow({ sp, route, open, toggle }) {
  const tree = useStore((s) => treeOf(sp.id, s));
  const activeSpace = route.parts[0] === 's' ? route.parts[1] : null;
  const activePage = route.parts[0] === 'p' ? route.parts[1] : null;
  const isOpen = open[sp.id] ?? (activeSpace === sp.id || tree.some((n) => n.id === activePage));
  return html`<div>
    <div class="tree-row space-row" aria-current=${activeSpace === sp.id && route.parts.length === 2 ? 'page' : undefined}>
      <a href=${href('/s/' + sp.id)} class="space-link"><${SpaceIcon} space=${sp} />
        <span class="name">${sp.name}</span>${sp.private && html`<span class="sr-only"> (private)</span>`}</a>
      ${tree.length > 0 && html`<button class="twist" aria-expanded=${String(!!isOpen)} aria-label=${(isOpen ? 'Hide pages in ' : 'Show pages in ') + sp.name} onClick=${() => toggle(sp.id, !isOpen)}><${Icon} name="chevronRight" /></button>`}
    </div>
    ${isOpen && tree.length > 0 && html`<${TreeNodes} nodes=${nest(tree)} depth=${1} activePage=${activePage} open=${open} toggle=${toggle} />`}
  </div>`;
}

function TreeNodes({ nodes, depth, activePage, open, toggle }) {
  return html`${nodes.map((n) => {
    const hasKids = n.children.length > 0;
    const isOpen = open['p:' + n.id] ?? hasDescendant(n, activePage);
    return html`<div key=${n.id}>
      <div class="tree-row" style=${{ paddingLeft: 8 + depth * 14 + 'px' }} aria-current=${activePage === n.id ? 'page' : undefined}>
        ${hasKids ? html`<button class="twist" aria-expanded=${String(!!isOpen)} aria-label=${(isOpen ? 'Collapse ' : 'Expand ') + n.title} onClick=${() => toggle('p:' + n.id, !isOpen)}><${Icon} name="chevronRight" /></button>` : html`<span class="twist"></span>`}
        <a href=${href('/p/' + n.id)} class="row" style="gap:8px;color:inherit;text-decoration:none;min-width:0;flex:1"><span class="emoji">${n.icon || '📄'}</span><span class="name">${n.title}</span></a>
      </div>
      ${hasKids && isOpen && html`<${TreeNodes} nodes=${n.children} depth=${depth + 1} activePage=${activePage} open=${open} toggle=${toggle} />`}
    </div>`;
  })}`;
}
function hasDescendant(n, id) { return !!id && n.children.some((c) => c.id === id || hasDescendant(c, id)); }

// ── Mobile chrome ──
function Topbar({ title }) {
  return html`<header class="topbar">
    <button onClick=${() => setState({ railOpen: true })} aria-label="Open menu"><${Icon} name="menu" /></button>
    <img src="assets/mark.png" alt="" />
    <div class="title">${title}</div>
    <button onClick=${() => setState({ paletteOpen: true })} aria-label="Search"><${Icon} name="search" /></button>
  </header>`;
}

function Tabbar({ route }) {
  const mine = useMyPresence();
  const tab = (to, icon, label, extra = '') => {
    const cur = to === '/' ? route.path === '/' : route.path.startsWith(to);
    return html`<a href=${href(to)} class=${extra} aria-current=${cur ? 'page' : undefined}><${Icon} name=${icon} />${label}</a>`;
  };
  return html`<nav class="tabbar" aria-label="Main">
    ${tab('/', 'home', 'Home')}
    ${tab('/time', 'clock', mine ? 'Clocked in' : 'Time', mine ? 'live' : '')}
    ${tab('/spaces', 'folder', 'Spaces')}
    ${tab('/calendar', 'calendar', 'Calendar')}
    <button type="button" onClick=${() => setState({ railOpen: true })}><${Icon} name="menu" />More</button>
  </nav>`;
}

// ── Search palette (Ctrl/Cmd + K) ──
function Palette() {
  const { open, profile, members, contents } = useStore((s) => ({ open: !!s.paletteOpen, profile: s.profile, members: s.membersCache, contents: s.contents }));
  const spaces = useStore((s) => visibleSpaces(s));
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setState({ paletteOpen: !getState().paletteOpen }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (open) { setQ(''); setSel(0); setTimeout(() => inputRef.current?.focus(), 10); }
    if (open && !getState().membersCache) getState().api.listMembers().then((m) => setState({ membersCache: m })).catch(() => {});
  }, [open]);

  const items = useMemo(() => {
    const lead = isLead(profile), admin = isAdmin(profile);
    const base = [
      { label: 'Home', to: '/', icon: 'home', kind: 'Go to' },
      { label: 'My time', to: '/time', icon: 'clock', kind: 'Go to' },
      lead && { label: 'Reports', to: '/reports', icon: 'chart', kind: 'Go to' },
      { label: 'Calendar', to: '/calendar', icon: 'calendar', kind: 'Go to' },
      { label: 'Announcements', to: '/announcements', icon: 'megaphone', kind: 'Go to' },
      { label: 'Tasks', to: '/tasks', icon: 'tasks', kind: 'Go to' },
      { label: 'Members', to: '/members', icon: 'users', kind: 'Go to' },
      { label: 'Your profile', to: '/profile', icon: 'user', kind: 'Go to' },
      admin && { label: 'Admin', to: '/admin', icon: 'shield', kind: 'Go to' },
    ].filter(Boolean);
    const sp = spaces.flatMap((s) => [
      { label: spaceLabel(s), to: '/s/' + s.id, icon: s.private ? 'hashLock' : 'hash', kind: 'Space' },
      { label: `${spaceLabel(s)} task board`, to: `/s/${s.id}/board`, icon: 'board', kind: 'Board' },
      ...(contents[s.id]?.tree || []).map((n) => ({ label: n.title, to: '/p/' + n.id, icon: 'page', kind: '#' + spaceLabel(s), emoji: n.icon })),
    ]);
    const people = (members || []).map((m) => ({ label: m.name, to: '/members/' + m.uid, icon: 'user', kind: 'Member' }));
    const all = [...base, ...sp, ...people];
    const needle = q.trim().toLowerCase();
    if (!needle) return all.slice(0, 12);
    return all
      .map((it) => { const l = it.label.toLowerCase(); const i = l.indexOf(needle); return { it, score: i < 0 ? -1 : (i === 0 ? 0 : l[i - 1] === ' ' ? 1 : 2) }; })
      .filter((x) => x.score >= 0).sort((a, b) => a.score - b.score || a.it.label.length - b.it.label.length).slice(0, 20).map((x) => x.it);
  }, [q, spaces, members, profile, contents]);

  if (!open) return null;
  const close = () => setState({ paletteOpen: false });
  const choose = (it) => { close(); go(it.to); };
  return html`<div class="palette-wrap" onMouseDown=${(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Search the portal">
      <div class="search"><${Icon} name="search" />
        <input ref=${inputRef} class="input" placeholder="Search pages, spaces, people…" value=${q}
          onInput=${(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown=${(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(sel + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(sel - 1, 0)); }
            else if (e.key === 'Enter' && items[sel]) choose(items[sel]);
          }} aria-controls="palette-list" /></div>
      <ul id="palette-list" role="listbox">
        ${items.map((it, i) => html`<li key=${it.kind + it.to}><a href=${href(it.to)} role="option" aria-selected=${String(i === sel)}
          onMouseEnter=${() => setSel(i)} onClick=${(e) => { e.preventDefault(); choose(it); }}>
          ${it.emoji ? html`<span style="width:17px;text-align:center">${it.emoji}</span>` : html`<${Icon} name=${it.icon} />`}<span>${it.label}</span><span class="kind">${it.kind}</span></a></li>`)}
        ${!items.length && html`<li class="muted small" style="padding:10px">Nothing matches “${q}”.</li>`}
      </ul>
    </div>
  </div>`;
}
