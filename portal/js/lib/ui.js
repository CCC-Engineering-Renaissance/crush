// Shared UI building blocks.
import { html, useEffect, useRef, useState, useCallback, useMemo } from '../../vendor/preact.js';
import { Icon } from './icons.js';
import { initials, colorFor } from './text.js';

export { html, useEffect, useRef, useState, useCallback, useMemo, Icon };

// ── Tiny observable lists for toasts and modals ──
function channel() {
  let items = [];
  const subs = new Set();
  return {
    get: () => items,
    set(next) { items = next; subs.forEach((f) => f(items)); },
    use() {
      const [v, setV] = useState(items);
      useEffect(() => { subs.add(setV); return () => subs.delete(setV); }, []);
      return v;
    },
  };
}

// ── Toasts ──
const toasts = channel();
let toastId = 0;
export function toast(message, { kind = 'ok', action, timeout = 4200 } = {}) {
  const id = ++toastId;
  toasts.set([...toasts.get(), { id, message, kind, action }]);
  setTimeout(() => toasts.set(toasts.get().filter((t) => t.id !== id)), timeout);
}
export function toastError(err, fallback = 'Something went wrong. Try again.') {
  console.error(err);
  toast(friendlyError(err, fallback), { kind: 'bad', timeout: 6500 });
}
export function friendlyError(err, fallback = 'Something went wrong. Try again.') {
  const code = err?.code || '';
  if (code === 'permission-denied') return 'You don’t have permission to do that.';
  if (code === 'unavailable') return 'You’re offline. Check your connection and try again.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the Google sign-in window. Allow pop-ups for this site, then try again.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was closed before it finished.';
  if (code === 'auth/unauthorized-domain') return 'This web address isn’t on the Firebase authorized domains list yet (SETUP.md, step 3).';
  if (code === 'failed-precondition' && /index/i.test(err?.message || '')) return 'A database index is still being set up (SETUP.md, step 4). Try again in a few minutes.';
  if (err?.userMessage) return err.userMessage;
  return fallback;
}
export function Toasts() {
  const list = toasts.use();
  return html`<div class="toasts" role="status" aria-live="polite">
    ${list.map((t) => html`<div class=${'toast ' + (t.kind === 'bad' ? 'bad' : '')} key=${t.id}>
      ${t.kind === 'bad' ? html`<${Icon} name="alert" size=${18} />` : html`<${Icon} name="check" size=${18} />`}
      <span>${t.message}</span>
      ${t.action && html`<button onClick=${() => { t.action.run(); toasts.set(toasts.get().filter((x) => x.id !== t.id)); }}>${t.action.label}</button>`}
    </div>`)}
  </div>`;
}

// ── Modals ──
const modals = channel();
let modalId = 0;
export function openModal(render, opts = {}) {
  const id = ++modalId;
  const close = () => modals.set(modals.get().filter((m) => m.id !== id));
  modals.set([...modals.get(), { id, render, close, opts }]);
  return close;
}
export function ModalHost() {
  const list = modals.use();
  return html`${list.map((m) => html`<${ModalFrame} key=${m.id} item=${m} />`)}`;
}
function ModalFrame({ item }) {
  const ref = useRef();
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    const first = el?.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button.btn-primary');
    (first || el)?.focus?.();
    // When one dialog opens over another, Escape closes only the top one.
    const onKey = (e) => {
      const list = modals.get();
      if (e.key !== 'Escape' || e.defaultPrevented || list[list.length - 1]?.id !== item.id) return;
      e.preventDefault(); e.stopPropagation(); item.close();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      if (!modals.get().length) document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, []);
  return html`<div class="modal-wrap" onMouseDown=${(e) => { if (e.target === e.currentTarget) item.close(); }}>
    <div ref=${ref} tabindex="-1">${item.render(item.close)}</div>
  </div>`;
}
export function Modal({ title, onClose, children, footer, wide, labelledBy }) {
  return html`<div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${labelledBy ? undefined : title}>
    <div class="modal-head"><h2>${title}</h2>
      <button class="btn btn-quiet btn-icon btn-sm" onClick=${onClose} aria-label="Close"><${Icon} name="x" size=${18} /></button>
    </div>
    <div class="modal-body">${children}</div>
    ${footer && html`<div class="modal-foot">${footer}</div>`}
  </div>`;
}

export function confirmDialog({ title, body, confirmLabel = 'Confirm', danger = false, cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    openModal((close) => html`<${Modal} title=${title} onClose=${() => { close(); resolve(false); }}
      footer=${html`<button class="btn" onClick=${() => { close(); resolve(false); }}>${cancelLabel}</button>
        <button class=${'btn ' + (danger ? 'btn-danger' : 'btn-primary')} autofocus onClick=${() => { close(); resolve(true); }}>${confirmLabel}</button>`}>
      <p style="margin:0;color:var(--text-2)">${body}</p>
    </${Modal}>`);
  });
}

// ── Small pieces ──
export function Avatar({ person, size = 32 }) {
  const name = person?.name || person?.email || '?';
  const [broken, setBroken] = useState(false);
  const photo = person?.photoURL && !broken ? person.photoURL : null;
  return html`<span class="avatar" style=${{ '--size': size + 'px', background: photo ? 'var(--panel-2)' : colorFor(person?.uid || name) }} title=${name}>
    ${photo ? html`<img src=${photo} alt="" referrerpolicy="no-referrer" onError=${() => setBroken(true)} />` : initials(name)}
  </span>`;
}

export function Spinner() { return html`<span class="spinner" aria-hidden="true"></span>`; }
export function Loading({ label = 'Loading…' }) { return html`<div class="loading"><${Spinner} />${label}</div>`; }

export function Empty({ title, children, action }) {
  return html`<div class="empty"><h3>${title}</h3>${children && html`<p>${children}</p>`}${action}</div>`;
}

export function Notice({ kind = 'info', icon, children }) {
  return html`<div class=${'notice ' + kind}><${Icon} name=${icon || (kind === 'warn' || kind === 'bad' ? 'alert' : 'info')} /><div class="grow">${children}</div></div>`;
}

export function Chip({ color, children, title }) {
  return html`<span class="chip" title=${title}>${color && html`<i style=${{ background: color }}></i>`}${children}</span>`;
}

export const STATUS = {
  open: ['Clocked in', 'badge-info'],
  complete: ['Counted', 'badge-ok'],
  pending: ['Waiting for approval', 'badge-warn'],
  rejected: ['Not counted', 'badge-bad'],
};
export function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status, 'badge-plain'];
  return html`<span class=${'badge ' + cls}>${label}</span>`;
}

export function Field({ label, hint, children, full, error }) {
  return html`<label class=${'field' + (full ? ' full' : '')}>
    <span>${label}</span>${children}${hint && html`<small>${hint}</small>`}${error && html`<small class="form-error">${error}</small>`}
  </label>`;
}

export function Seg({ options, value, onChange, label }) {
  return html`<div class="seg" role="group" aria-label=${label}>
    ${options.map(([v, l]) => html`<button type="button" key=${v} aria-pressed=${String(v === value)} onClick=${() => onChange(v)}>${l}</button>`)}
  </div>`;
}

export function useOutside(ref, onOutside, active = true) {
  useEffect(() => {
    if (!active) return;
    const fn = (e) => { if (ref.current && !ref.current.contains(e.target)) onOutside(); };
    const key = (e) => { if (e.key === 'Escape') onOutside(); };
    document.addEventListener('mousedown', fn);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', fn); document.removeEventListener('keydown', key); };
  }, [active]);
}

export function MultiSelect({ options, value = [], onChange, placeholder = 'Any', allLabel, searchable }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef();
  useOutside(ref, () => setOpen(false), open);
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const summary = value.length === 0 ? (allLabel || placeholder)
    : value.length === 1 ? (options.find((o) => o.value === value[0])?.label || '1 selected')
    : `${value.length} selected`;
  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return html`<div class="multi" ref=${ref}>
    <button type="button" aria-haspopup="listbox" aria-expanded=${String(open)} onClick=${() => setOpen(!open)}>${summary}</button>
    ${open && html`<div class="pop" role="listbox" aria-multiselectable="true">
      ${(searchable || options.length > 8) && html`<input class="input" placeholder="Search" value=${q} onInput=${(e) => setQ(e.target.value)} autofocus />`}
      ${value.length > 0 && html`<label><input type="checkbox" checked=${false} onChange=${() => onChange([])} /><span class="muted">Clear selection</span></label>`}
      ${shown.map((o) => html`<label key=${o.value}>
        <input type="checkbox" checked=${value.includes(o.value)} onChange=${() => toggle(o.value)} />
        ${o.color && html`<i style=${{ width: '9px', height: '9px', borderRadius: '50%', background: o.color, flex: 'none' }}></i>`}
        <span>${o.label}</span></label>`)}
      ${!shown.length && html`<div class="muted small" style="padding:8px">No matches</div>`}
    </div>`}
  </div>`;
}

export function Menu({ items, label = 'More actions', icon = 'more', btnClass = 'btn btn-quiet btn-icon btn-sm', text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useOutside(ref, () => setOpen(false), open);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return html`<div class="rel" ref=${ref}>
    <button class=${btnClass} aria-label=${text ? undefined : label} aria-haspopup="menu" aria-expanded=${String(open)} onClick=${() => setOpen(!open)}><${Icon} name=${icon} size=${18} />${text}</button>
    ${open && html`<div class="menu" role="menu">
      ${shown.map((it, i) => it.href
        ? html`<a key=${i} role="menuitem" href=${it.href} target=${it.external ? '_blank' : undefined} rel=${it.external ? 'noopener noreferrer' : undefined} onClick=${() => setOpen(false)}>${it.icon && html`<${Icon} name=${it.icon} />`}${it.label}</a>`
        : html`<button key=${i} role="menuitem" class=${it.danger ? 'danger' : ''} onClick=${() => { setOpen(false); it.onClick(); }}>${it.icon && html`<${Icon} name=${it.icon} />`}${it.label}</button>`)}
    </div>`}
  </div>`;
}

export function useNow(ms = 1000, active = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

// Load data once (and again when deps change). Returns { data, error, loading, reload }.
export function useAsync(fn, deps = []) {
  const [st, setSt] = useState({ data: undefined, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      (data) => live && setSt({ data, error: null, loading: false }),
      (error) => { console.error(error); live && setSt({ data: undefined, error, loading: false }); },
    );
    return () => { live = false; };
  }, [...deps, tick]);
  return { ...st, reload: () => setTick((t) => t + 1) };
}

// Subscribe to a live query. subscribe(cb) must return an unsubscribe function.
export function useLive(subscribe, deps = []) {
  const [st, setSt] = useState({ data: undefined, error: null });
  useEffect(() => {
    setSt({ data: undefined, error: null });
    let unsub;
    try { unsub = subscribe((data) => setSt({ data, error: null }), (error) => setSt({ data: undefined, error })); }
    catch (error) { setSt({ data: undefined, error }); }
    return () => unsub && unsub();
  }, deps);
  return st;
}

// Eight to a row: notes, tools, electronics, science and bodies, the water, media and business, the rest.
export const EMOJIS = ['📄', '📌', '📋', '🗂️', '📎', '📝', '✅', '🗓️',
  '🛠️', '🔧', '🔨', '🔩', '⚙️', '🧰', '📐', '📏',
  '⚡', '🔌', '🔋', '💡', '💻', '🕹️', '🤖', '📡',
  '🧪', '🔬', '🧲', '🧠', '🦾', '🦿', '✋', '🛰️',
  '🌊', '🏊', '🎈', '⚓', '🐙', '🦈', '🐂', '🚀',
  '📷', '🎬', '🎨', '📣', '💼', '💰', '📈', '🤝',
  '🏆', '🎓', '🎯', '🧭', '⚠️', '❤️', '⭐', '📦'];

export function EmojiPicker({ onPick, onClose }) {
  return html`<${Modal} title="Choose an icon" onClose=${onClose}
    footer=${html`<button class="btn" onClick=${() => { onPick(''); onClose(); }}>Use no icon</button>`}>
    <div class="emoji-grid">${EMOJIS.map((e) => html`<button key=${e} onClick=${() => { onPick(e); onClose(); }} aria-label=${'Use ' + e}>${e}</button>`)}</div>
  </${Modal}>`;
}

// A page or space icon: the emoji someone picked, or the plain page / folder icon.
export function ItemIcon({ icon, kind = 'page', size = 18 }) {
  if (icon) return html`<span class="item-icon" aria-hidden="true" style=${{ fontSize: size + 'px' }}>${icon}</span>`;
  return html`<span class="item-icon" aria-hidden="true"><${Icon} name=${kind === 'space' ? 'folder' : 'page'} size=${Math.round(size * 0.9)} /></span>`;
}
