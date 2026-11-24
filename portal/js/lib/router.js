// Hash routes (#/time, #/p/<pageId>) work on GitHub Pages without any server setup.
import { useEffect, useState } from '../../vendor/preact.js';

export function parseHash() {
  const raw = (location.hash || '').replace(/^#/, '') || '/';
  const qi = raw.indexOf('?');
  const path = qi >= 0 ? raw.slice(0, qi) : raw;
  const qs = qi >= 0 ? raw.slice(qi + 1) : '';
  const parts = path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { path: '/' + parts.join('/'), parts, query: new URLSearchParams(qs || '') };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path, { replace = false } = {}) {
  const url = '#' + path;
  if (replace) { history.replaceState(null, '', url); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else location.hash = url;
}

export const href = (path) => '#' + path;
