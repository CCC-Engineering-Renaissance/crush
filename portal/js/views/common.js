// Pieces shared across screens: depth-contour artwork, the demo bar, theme handling.
import { html, useState, useEffect, Icon } from '../lib/ui.js';
import { useStore, setState, groupBySubsidiary } from '../lib/store.js';
import { isIconImage } from '../lib/picture.js';

// Bathymetric contour lines, like a chart of the sea floor around a seamount.
function ringPath(cx, cy, r, k) {
  const pts = [];
  const N = 72;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rr = r * (1 + 0.09 * Math.sin(3 * a + k) + 0.05 * Math.sin(5 * a + 2.3 * k) + 0.025 * Math.sin(11 * a + 0.7 * k));
    pts.push([cx + rr * Math.cos(a), cy + rr * 0.78 * Math.sin(a)]);
  }
  let d = '';
  for (let i = 0; i < N; i++) {
    const p = pts[i], q = pts[(i + 1) % N];
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    d += i === 0 ? `M${mx.toFixed(1)} ${my.toFixed(1)}` : ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const p0 = pts[0], m0 = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  return d + ` Q${p0[0].toFixed(1)} ${p0[1].toFixed(1)} ${m0[0].toFixed(1)} ${m0[1].toFixed(1)}Z`;
}

export function Contours({ cx = 820, cy = 120, rings = 11, step = 62, labels = false, stroke = 'rgba(255,255,255,.09)' }) {
  const items = [];
  for (let i = 1; i <= rings; i++) items.push({ d: ringPath(cx, cy, i * step, i * 1.7), i });
  return html`<svg class="contours" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    ${items.map(({ d, i }) => html`<path key=${i} d=${d} fill="none" stroke=${i % 4 === 0 ? 'rgba(171,225,224,.2)' : stroke} stroke-width=${i % 4 === 0 ? 1.4 : 1} />`)}
    ${labels && [4, 8].map((i) => html`<text key=${'t' + i} x=${cx - i * step * 0.92} y=${cy + 6} fill="rgba(171,225,224,.45)"
      font-family="Chakra Petch, sans-serif" font-size="13" letter-spacing="1">${i * 10} m</text>`)}
  </svg>`;
}

export function DemoBar() {
  const api = useStore((s) => s.api);
  const [persona, setPersona] = useState(api?.persona);
  if (!api || api.mode !== 'demo') return null;
  return html`<aside class="demo-bar" aria-label="Demo mode">
    <strong>Demo mode.</strong>
    <span class="why">Sample data, saved only in this browser. Nothing here is real.</span>
    <label class="row" style="gap:6px">View as
      <select value=${persona} onChange=${(e) => { setPersona(e.target.value); api.setPersona(e.target.value); }}>
        ${api.personas.map((p) => html`<option value=${p.key} key=${p.key}>${p.label}</option>`)}
      </select>
    </label>
    <button class="link-btn" onClick=${() => api.reset()}>Reset sample data</button>
  </aside>`;
}

// The browser's toolbar colour: the sign-in screens' ground (light or dark, as the theme resolves),
// or the portal's dark header while someone is inside. index.html has a first guess per scheme.
let insideColor = null;
function refreshBrowserColor() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const color = insideColor || (dark ? '#0F1217' : '#F4F5F7');
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', color));
}
export function setBrowserColor(color) { insideColor = color; refreshBrowserColor(); }

// Theme: 'system' follows the device; 'light' / 'dark' override it.
export function applyTheme(pref) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  refreshBrowserColor();
}
export function initTheme() {
  let pref = 'system';
  try { pref = localStorage.getItem('er-theme') || 'system'; } catch { /* private mode */ }
  setState({ theme: pref });
  applyTheme(pref);
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(useThemePref()));
}
function useThemePref() { try { return localStorage.getItem('er-theme') || 'system'; } catch { return 'system'; } }
export function setTheme(pref) {
  try { localStorage.setItem('er-theme', pref); } catch { /* ignore */ }
  setState({ theme: pref });
  applyTheme(pref);
}

export function useTitle(title) {
  useEffect(() => { document.title = title ? `${title} — ER Portal` : 'Member Portal — Engineering Renaissance'; }, [title]);
}

// Subteam chips grouped under their subsidiary, so Crush Depth's "Electrical" and Prosthetic's
// "Electrical" can't be mixed up. Pass `everyone` to add an "Everyone" chip that clears the choice.
export function SubteamPicker({ value = [], onChange, subteams, subsidiaries, everyone }) {
  const store = useStore((s) => ({ subteams: s.subteams, subsidiaries: s.subsidiaries }));
  const groups = groupBySubsidiary(subteams || store.subteams, subsidiaries || store.subsidiaries).filter((g) => g.items.length);
  const named = groups.some((g) => g.sub);
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return html`<div class="pick-groups">
    ${everyone && html`<div class="chips"><button type="button" class="chip chip-toggle" aria-pressed=${String(!value.length)} onClick=${() => onChange([])}>${everyone}</button></div>`}
    ${groups.map((g) => {
      const name = g.sub?.name || 'Club-wide';
      return html`<div class="pick-group" key=${g.sub?.id || '-'} role=${named ? 'group' : undefined} aria-label=${named ? `${name} subteams` : undefined}>
        ${named && html`<span class="pick-group-name" aria-hidden="true">${name}</span>`}
        <div class="chips">${g.items.map((t) => html`<button type="button" key=${t.id} class="chip chip-toggle" aria-pressed=${String(value.includes(t.id))}
          aria-label=${named ? `${t.name}, ${name}` : undefined} onClick=${() => toggle(t.id)}>${t.name}</button>`)}</div>
      </div>`;
    })}
    ${!groups.length && html`<p class="small muted" style="margin:0">No subteams yet.</p>`}
  </div>`;
}

// A space's icon: a picture someone uploaded, an emoji, or a hash like a chat channel (with a lock
// when only chosen people can open it). Leads choose it in the space's settings.
export function SpaceIcon({ space, size = 18 }) {
  const box = { width: size + 'px', height: size + 'px' };
  if (isIconImage(space?.iconImage)) return html`<span class="space-ico" style=${box}><img src=${space.iconImage} alt="" width=${size} height=${size} /></span>`;
  if (space?.icon) return html`<span class="space-ico is-emoji" aria-hidden="true" style=${{ ...box, fontSize: Math.round(size * 0.84) + 'px' }}>${space.icon}</span>`;
  return html`<${Icon} name=${space?.private ? 'hashLock' : 'hash'} size=${size} />`;
}
export const hasOwnIcon = (space) => !!(space && (isIconImage(space.iconImage) || space.icon));
