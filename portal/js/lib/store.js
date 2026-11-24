// One small app-wide store. Views read slices with useStore(selector) and re-render only
// when their slice changes.
import { useEffect, useRef, useState } from '../../vendor/preact.js';

export const DEFAULT_SETTINGS = {
  clubName: 'Engineering Renaissance',
  meetingInfo: '',
  termName: 'Fall 2026',
  termStart: '2026-08-10',
  termEnd: '2026-12-12',
  termGoalHours: 40,
  weeklyGoalHours: 4,
  maxSessionHours: 10,
  locationCheck: { enabled: false, mode: 'flag', lat: null, lng: null, radiusM: 250 },
};

const state = {
  api: null,            // active backend (firebase or demo)
  config: null,
  authUser: undefined,  // undefined = still checking, null = signed out
  profile: undefined,   // undefined = loading, null = no profile yet
  settings: DEFAULT_SETTINGS,
  subteams: [],
  activities: [],
  spaces: [],
  presence: [],
  pendingFixes: [],
  pendingMembers: [],
  membersCache: null,
  railOpen: false,
  paletteOpen: false,
  theme: 'system',
  rev: 0,               // bumped after edits so lists that aren't live re-load
};

const subs = new Set();

export function getState() { return state; }

export function setState(patch) {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  for (const fn of subs) fn();
}

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

export function useStore(selector = (s) => s) {
  const [, force] = useState(0);
  const sel = useRef(selector);
  sel.current = selector;
  const last = useRef(selector(state));
  useEffect(() => {
    const fn = () => {
      let next;
      try { next = sel.current(state); } catch { return; } // component is about to unmount
      if (!shallowEqual(next, last.current)) { last.current = next; force((n) => n + 1); }
    };
    subs.add(fn);
    return () => subs.delete(fn);
  }, []);
  last.current = selector(state);
  return last.current;
}

export function bump() { setState({ rev: state.rev + 1 }); }

// Helpers derived from state
export const api = () => state.api;
export const me = () => state.profile;
export const isLead = (p = state.profile) => !!p && p.status === 'active' && (p.role === 'lead' || p.role === 'admin');
export const isAdmin = (p = state.profile) => !!p && p.status === 'active' && p.role === 'admin';
export const subteamById = (id) => state.subteams.find((s) => s.id === id);
export const activityById = (id) => state.activities.find((a) => a.id === id);
export const spaceById = (id) => state.spaces.find((s) => s.id === id);
