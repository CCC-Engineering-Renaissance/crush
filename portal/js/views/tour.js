// The guided tour: the page dims except the part being explained, one step at a time.
// Live portal: starts on a member's first visit, and their profile remembers they've seen it.
// Demo: starts after every sign-in. Anyone can take it again from the menu.
import { html, useState, useEffect, useRef } from '../lib/ui.js';
import { useStore, getState, setState, isLead, isAdmin } from '../lib/store.js';
import { go } from '../lib/router.js';

const PAD = 6;     // room around the highlighted part
const GAP = 14;    // between the highlight and the card
const EDGE = 12;   // the card keeps this far from the screen's edges
const DRAWER = '(max-width: 900px)';   // where the sidebar becomes a drawer (app.css)
const PHONE = 640;                      // narrower than this, the card docks to the top or bottom
const SEEN_KEY = 'er-tour-seen:';       // + uid: this device remembers, even if saving to the profile fails

export const startTour = () => window.dispatchEvent(new Event('er-tour-start'));
export const tourRunning = () => document.documentElement.classList.contains('touring');

// Does the tour start by itself? In the demo, after every sign-in. In the live portal, on a
// member's first visit.
export function shouldAutoStart({ demo, signedInNow, profile, seenHere }) {
  if (!profile || profile.status !== 'active') return false;
  if (demo) return !!signedInNow;
  return !profile.tourDone && !seenHere;
}

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const listOf = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// Each step: `at` names a data-tour="…" element (no `at`: the card sits in the middle).
// `home` steps happen on Home. `menu` steps are in the sidebar, a drawer on phones.
export function tourSteps(profile, subsidiaries = []) {
  const lead = isLead(profile);
  const admin = isAdmin(profile);
  const first = String(profile?.name || '').trim().split(/\s+/)[0];
  const groups = subsidiaries.map((s) => s.name).filter(Boolean);
  return [
    { id: 'welcome', title: first ? `Welcome, ${first}` : 'Welcome to the portal', body: 'Here’s a quick look around. It takes about a minute, and you can skip it any time.' },
    { id: 'clock', at: 'clock', home: true, title: 'Clock in and out', body: 'Clock in when you start working on club stuff, pick what you’re working on, and clock out when you’re done.' },
    { id: 'working', at: 'working', home: true, title: 'Working currently', body: 'Who’s clocked in right now, and for how long.' },
    { id: 'time', at: 'nav-time', menu: true, title: 'My time', body: 'Every session you’ve worked. If you forget to clock out, you send a fix and a lead approves it.' },
    lead && { id: 'reports', at: 'nav-reports', menu: true, title: 'Reports', body: 'Hours by any mix of dates, people, subteams, activities and events.' },
    { id: 'calendar', at: 'nav-calendar', menu: true, title: 'Calendar', body: 'Meetings, build days, pool tests and competitions. Subscribe to keep them in your own calendar app.' },
    { id: 'news', at: 'nav-announcements', menu: true, title: 'Announcements', body: 'News from officers and leads, including Discord posts that mention the portal bot.' },
    { id: 'tasks', at: 'nav-tasks', menu: true, title: 'Tasks', body: 'Everything assigned to you, from every space’s task board.' },
    { id: 'members', at: 'nav-members', menu: true, title: 'Members', body: 'Find a teammate by name, subteam or skill.' },
    { id: 'spaces', at: 'spaces', menu: true, title: 'Spaces', body: `Like Discord channels: one for each subteam${groups.length ? `, grouped under ${listOf(groups)}` : ''}. Each has pages, a Drive folder and a task board.` },
    { id: 'search', at: 'search', menu: true, title: 'Search', body: `Find any page, space or task board. Shortcut: ${isMac() ? '⌘K' : 'Ctrl+K'}.` },
    admin && { id: 'admin', at: 'nav-admin', menu: true, title: 'Admin', body: 'Approve new members, set roles, and manage subteams, spaces and settings.' },
    { id: 'me', at: 'me', menu: true, title: 'Your profile', body: 'What other members see about you. You sign out from there too.' },
    { id: 'again', at: 'tour', menu: true, title: 'That’s the tour', body: 'Take it again any time from here.' },
  ].filter(Boolean);
}

// Where the card goes: beside sidebar items, otherwise below or above the highlight.
// Phones get a sheet at the bottom, or at the top when the highlight is low on the screen.
export function placeCard(r, card, vw, vh) {
  const cw = card?.width || 340;
  const ch = card?.height || 190;
  if (!r) return { left: Math.max(EDGE, (vw - cw) / 2), top: Math.max(EDGE, (vh - ch) / 2) };
  if (vw < PHONE) return { dock: r.top + r.height / 2 > vh * 0.52 ? 'top' : 'bottom' };
  const clampX = (x) => Math.min(Math.max(EDGE, x), vw - cw - EDGE);
  const clampY = (y) => Math.min(Math.max(EDGE, y), vh - ch - EDGE);
  const right = r.left + r.width + GAP;
  if (right + cw <= vw - EDGE && r.left + r.width < vw * 0.45) return { left: right, top: clampY(r.top + Math.min(r.height, 80) / 2 - ch / 2) };
  if (r.top + r.height + GAP + ch <= vh - EDGE) return { left: clampX(r.left + r.width / 2 - cw / 2), top: r.top + r.height + GAP };
  if (r.top - GAP - ch >= EDGE) return { left: clampX(r.left + r.width / 2 - cw / 2), top: r.top - GAP - ch };
  if (right + cw <= vw - EDGE) return { left: right, top: clampY(r.top) };
  return { left: clampX(r.left + r.width / 2 - cw / 2), top: vh - ch - EDGE };
}

// The nearest ancestor that scrolls (the menu drawer, or the page itself).
function scrollParent(el) {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return document.scrollingElement || document.documentElement;
}

// Phones: the card docks to the bottom and the highlighted part scrolls into the space above it.
// Parts that can't move up that far, like the end of the menu, get the card at the top instead.
function settleOnPhone(el, cardH) {
  const vh = window.innerHeight;
  const sc = scrollParent(el);
  const page = sc === document.scrollingElement || sc === document.documentElement;
  // The page's top bar sticks to the top once the page scrolls, so leave room for its height.
  const top0 = page ? (document.querySelector('.topbar')?.offsetHeight || 0) : 0;
  const b = el.getBoundingClientRect();
  const room = { down: sc.scrollHeight - sc.clientHeight - sc.scrollTop, up: sc.scrollTop };
  const shift = (lo, hi) => {
    if (b.height > hi - lo || b.top < lo) return b.top - lo;   // too tall, or above: its top goes to lo
    return b.bottom > hi ? b.bottom - hi : 0;
  };
  const fits = (d) => (d > 0 ? d <= room.down + 1 : -d <= room.up + 1);
  let dock = 'bottom';
  let d = shift(top0 + 10, vh - cardH - 26);
  if (!fits(d)) {
    const t = shift(cardH + 26, vh - 10);
    if (fits(t) || Math.abs(t) < Math.abs(d)) { dock = 'top'; d = t; }
  }
  d = Math.max(-room.up, Math.min(room.down, d));
  if (Math.abs(d) > 1) sc.scrollBy({ top: d, behavior: reduced() ? 'auto' : 'smooth' });
  return dock;
}

const seenHere = (uid) => { try { return localStorage.getItem(SEEN_KEY + uid) === '1'; } catch { return false; } };
const markSeen = (uid) => { try { localStorage.setItem(SEEN_KEY + uid, '1'); } catch { /* private mode */ } };
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const drawer = () => !!window.matchMedia?.(DRAWER).matches;
const here = () => (location.hash || '#/').slice(1) || '/';
const same = (a, b) => (a && b ? Math.abs(a.left - b.left) < 0.5 && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5 : a === b);
const samePos = (a, b) => a.dock === b.dock && Math.abs((a.left || 0) - (b.left || 0)) < 0.5 && Math.abs((a.top || 0) - (b.top || 0)) < 0.5;

export function TourHost() {
  const { api, profile, subsidiaries, signedInNow } = useStore((s) => ({ api: s.api, profile: s.profile, subsidiaries: s.subsidiaries, signedInNow: s.tourAfterSignIn }));
  const [run, setRun] = useState(null); // { i, dir, from }
  const [geo, setGeo] = useState({ hole: null, pos: {} });
  const cardRef = useRef();
  const primaryRef = useRef();
  const inPortal = profile?.status === 'active';
  const steps = inPortal ? tourSteps(profile, subsidiaries) : [];
  const live = useRef({});
  live.current = { steps, run, profile, api };

  const begin = () => {
    if (!getState().profile || getState().profile.status !== 'active') return;
    if (getState().paletteOpen) setState({ paletteOpen: false });
    setGeo({ hole: null, pos: {} });
    setRun({ i: 0, dir: 1, from: here() });
  };
  const finish = () => {
    const { run: r, profile: p, api: a } = live.current;
    if (!r) return;
    markSeen(p.uid);
    if (a && a.mode !== 'demo' && !p.tourDone) a.updateMyProfile(p.uid, { tourDone: true }).catch(() => { /* this device still remembers */ });
    setRun(null);
    if (getState().railOpen) setState({ railOpen: false });
    if (r.from && r.from !== here()) go(r.from);
    window.dispatchEvent(new Event('er-tour-end'));
  };
  const move = (d) => {
    const { run: r, steps: s } = live.current;
    if (!r) return;
    const i = r.i + d;
    if (i < 0) return;
    if (i >= s.length) { finish(); return; }
    setRun({ ...r, i, dir: d });
  };

  // Started from the menu.
  useEffect(() => {
    const onStart = () => begin();
    window.addEventListener('er-tour-start', onStart);
    return () => window.removeEventListener('er-tour-start', onStart);
  }, []);

  // Started by itself, once the portal has had a moment to draw.
  useEffect(() => {
    if (!inPortal || !api || run) return undefined;
    if (!shouldAutoStart({ demo: api.mode === 'demo', signedInNow, profile, seenHere: seenHere(profile.uid) })) return undefined;
    const t = setTimeout(() => { setState({ tourAfterSignIn: false }); begin(); }, 700);
    return () => clearTimeout(t);
  }, [inPortal, api, profile?.uid, profile?.tourDone, signedInNow]);

  // While it runs: the page underneath can't be clicked or tabbed into; keys move the tour.
  const running = !!run;
  useEffect(() => {
    if (!running) return undefined;
    const before = document.activeElement;
    const app = document.querySelector('.app');
    app?.setAttribute('inert', '');
    document.documentElement.classList.add('touring');
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(); }
      else if (e.key === 'ArrowRight' && !e.altKey) { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowLeft' && !e.altKey) { e.preventDefault(); move(-1); }
      else if (e.key === 'Tab') {
        // Keep keyboard focus inside the card.
        const items = [...(cardRef.current?.querySelectorAll('button') || [])];
        if (!items.length) return;
        const at = items.indexOf(document.activeElement);
        const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : (at === items.length - 1 ? 0 : at + 1);
        e.preventDefault();
        items[next].focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      app?.removeAttribute('inert');
      document.documentElement.classList.remove('touring');
      // Back to where focus was, unless that's inside a drawer that's now closed.
      if (before && before !== document.body && document.contains(before) && !(drawer() && before.closest?.('.rail'))) before.focus?.({ preventScroll: true });
      else document.getElementById('content')?.focus({ preventScroll: true });
    };
  }, [running]);

  // Each step: go to Home if it's about Home, open or close the drawer on phones, and focus the card.
  const step = run ? steps[Math.min(run.i, steps.length - 1)] : null;
  useEffect(() => {
    if (!run || !step) return;
    if (step.home && here() !== '/') go('/');
    if (drawer()) setState({ railOpen: !!step.menu });
    primaryRef.current?.focus({ preventScroll: true });
  }, [run?.i]);

  // Follow the highlighted part every frame: it may scroll, slide in with the drawer or move
  // when the window changes size. A part that never turns up is skipped.
  useEffect(() => {
    if (!run) return undefined;
    let raf = 0;
    let settled = false;
    let dock = null;
    const t0 = performance.now();
    const tick = () => {
      const { steps: s, run: r } = live.current;
      const st = r && s[r.i];
      if (!st) return;
      let hole = null;
      if (st.at) {
        const el = document.querySelector(`[data-tour="${st.at}"]`);
        const b = el?.getBoundingClientRect();
        if (b && b.width && b.height) {
          if (!settled) {
            // Once per step: bring it into view, clear of the card.
            settled = true;
            const vh = window.innerHeight;
            if (window.innerWidth < PHONE) dock = settleOnPhone(el, cardRef.current?.getBoundingClientRect().height || 200);
            else if (b.top < 8 || b.bottom > vh - 8) el.scrollIntoView({ block: b.height > vh * 0.6 ? 'start' : 'center', behavior: reduced() ? 'auto' : 'smooth' });
          }
          const vh = window.innerHeight;
          const top = Math.max(b.top - PAD, 4);
          const bottom = Math.min(b.bottom + PAD, vh - 4);
          hole = { left: b.left - PAD, top, width: b.width + PAD * 2, height: Math.max(bottom - top, 8) };
        } else if (performance.now() - t0 > 1500) { move(r.dir || 1); return; }
      }
      const pos = dock && hole ? { dock } : placeCard(hole, cardRef.current?.getBoundingClientRect(), window.innerWidth, window.innerHeight);
      setGeo((g) => (same(g.hole, hole) && samePos(g.pos, pos) ? g : { hole, pos }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run?.i]);

  if (!run || !step) return null;
  const n = steps.length;
  const i = Math.min(run.i, n - 1);
  const last = i === n - 1;
  const { hole, pos } = geo;
  const holeStyle = hole
    ? { left: hole.left + 'px', top: hole.top + 'px', width: hole.width + 'px', height: hole.height + 'px' }
    : { left: '50%', top: '50%', width: '0px', height: '0px' };
  const cardStyle = pos.dock ? {} : { left: (pos.left ?? EDGE) + 'px', top: (pos.top ?? EDGE) + 'px' };
  // The page doesn't scroll or take clicks underneath; the tour scrolls each part into view itself.
  return html`<div class="tour" onMouseDown=${(e) => e.preventDefault()} onWheel=${(e) => e.preventDefault()}>
    <div class=${'tour-hole' + (hole ? '' : ' is-empty')} style=${holeStyle} aria-hidden="true"></div>
    <section ref=${cardRef} class=${'tour-card' + (pos.dock ? ' dock-' + pos.dock : '')} style=${cardStyle}
      role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <div class="tour-progress" aria-hidden="true"><span style=${{ width: ((i + 1) / n) * 100 + '%' }}></span></div>
      <p class="tour-count">${i === 0 ? 'Tour' : `${i + 1} of ${n}`}</p>
      <h2 id="tour-title">${step.title}</h2>
      <p id="tour-body">${step.body}</p>
      <div class="tour-actions">
        ${!last && html`<button type="button" class="btn btn-quiet" onClick=${finish}>${i === 0 ? 'Skip' : 'Skip tour'}</button>`}
        <span class="spacer"></span>
        ${i > 0 && html`<button type="button" class="btn" onClick=${() => move(-1)}>Back</button>`}
        <button type="button" class="btn btn-primary" ref=${primaryRef} onClick=${() => move(1)}>${i === 0 ? 'Show me around' : last ? 'Done' : 'Next'}</button>
      </div>
    </section>
    <p class="sr-only" aria-live="polite">${`Step ${i + 1} of ${n}. ${step.title}. ${step.body}`}</p>
  </div>`;
}
