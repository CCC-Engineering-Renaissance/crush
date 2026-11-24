// Text helpers. User-written text is rendered as Preact nodes (never raw HTML),
// except page content, which goes through DOMPurify with a short allowlist.
import { html } from '../../vendor/preact.js';
import DOMPurify from '../../vendor/purify.js';

export function initials(name = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Every colour keeps white initials at 4.5:1 or better.
const AVATAR_COLORS = ['#273784', '#1C6E8E', '#317259', '#4E6B1C', '#2E7D7F', '#5B4B9A', '#8A4B2F', '#2F5D8A'];
export function colorFor(key = '') {
  let h = 0;
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function truncate(s = '', n = 140) { s = String(s); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; }

// ── Markdown-lite for announcements and task descriptions ──
// Supports paragraphs, line breaks, "- " lists, **bold**, *italic*, `code`, [text](https://…) and bare links.
const SAFE_URL = /^(https?:\/\/|mailto:|#\/)/i;

function inline(text, keyBase = 'i') {
  const out = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
  let last = 0, m, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[1]) out.push(html`<strong key=${key}>${m[2]}</strong>`);
    else if (m[3]) out.push(html`<em key=${key}>${m[4]}</em>`);
    else if (m[5]) out.push(html`<code key=${key}>${m[6]}</code>`);
    else if (m[7]) {
      const url = m[9];
      out.push(SAFE_URL.test(url)
        ? html`<a key=${key} href=${url} target=${url.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">${m[8]}</a>`
        : m[0]);
    } else if (m[10]) out.push(html`<a key=${key} href=${m[10]} target="_blank" rel="noopener noreferrer">${m[10]}</a>`);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text = '', class: cls = 'prose' }) {
  const blocks = String(text).replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return html`<div class=${cls}>${blocks.map((b, i) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return html`<ul key=${i}>${lines.map((l, j) => html`<li key=${j}>${inline(l.replace(/^\s*[-*•]\s+/, ''), `${i}-${j}`)}</li>`)}</ul>`;
    }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      return html`<ol key=${i}>${lines.map((l, j) => html`<li key=${j}>${inline(l.replace(/^\s*\d+[.)]\s+/, ''), `${i}-${j}`)}</li>`)}</ol>`;
    }
    return html`<p key=${i}>${lines.map((l, j) => html`${j ? html`<br />` : null}${inline(l, `${i}-${j}`)}`)}</p>`;
  })}</div>`;
}

// ── Sanitizing rich text from pages (Editor.js stores inline HTML) ──
const INLINE_CFG = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 's', 'a', 'mark', 'code', 'br', 'span'],
  ALLOWED_ATTR: ['href', 'class'],
  ALLOW_DATA_ATTR: false,
};
let hooked = false;
function hook() {
  if (hooked) return; hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const h = node.getAttribute('href') || '';
      if (!SAFE_URL.test(h)) node.removeAttribute('href');
      else if (!h.startsWith('#')) { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
    }
  });
}
export function cleanInline(s) {
  hook();
  return DOMPurify.sanitize(String(s ?? ''), INLINE_CFG);
}

// Deep-clean every string inside Editor.js block data before it is rendered or edited.
export function cleanBlocks(content) {
  const walk = (v) => {
    if (typeof v === 'string') return cleanInline(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    return v;
  };
  const blocks = Array.isArray(content?.blocks) ? content.blocks : [];
  return {
    blocks: blocks
      .filter((b) => b && typeof b.type === 'string')
      .map((b) => (b.type === 'code' ? { ...b, data: { code: String(b.data?.code ?? '') } } : { ...b, data: walk(b.data || {}) })),
  };
}

export const plainText = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
