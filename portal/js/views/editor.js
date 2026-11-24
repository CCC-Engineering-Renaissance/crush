// Page content: a block editor (Editor.js, loaded only when someone edits) and a read-only
// renderer. Every string is sanitized before it is shown or handed to the editor.
import { html, useState, useEffect, useRef, Icon } from '../lib/ui.js';
import { cleanBlocks, cleanInline } from '../lib/text.js';
import { driveConfigured, pickFromDrive, preloadDrive, parseDriveLink, embedUrl, openUrl, kindOf } from '../google/drive.js';

// ───────── Read-only rendering ─────────
export function BlocksView({ content, onToggleCheck }) {
  const { blocks } = cleanBlocks(content);
  if (!blocks.length) return null;
  return html`<div class="prose">${blocks.map((b, i) => html`<${Block} key=${b.id || i} b=${b} path=${[i]} onToggleCheck=${onToggleCheck} />`)}</div>`;
}

const rich = (s) => ({ __html: cleanInline(s) });

function Block({ b, path, onToggleCheck }) {
  const d = b.data || {};
  switch (b.type) {
    case 'paragraph': return html`<p dangerouslySetInnerHTML=${rich(d.text)}></p>`;
    case 'header': {
      const lvl = Math.min(4, Math.max(2, Number(d.level) || 2));
      return lvl === 2 ? html`<h2 dangerouslySetInnerHTML=${rich(d.text)}></h2>` : lvl === 3 ? html`<h3 dangerouslySetInnerHTML=${rich(d.text)}></h3>` : html`<h4 dangerouslySetInnerHTML=${rich(d.text)}></h4>`;
    }
    case 'list': return html`<${List} style=${d.style} items=${d.items || []} path=${path} onToggleCheck=${onToggleCheck} />`;
    case 'checklist': return html`<ul class="checklist">${(d.items || []).map((it, k) => html`<li key=${k} class=${it.checked ? 'done' : ''}><span class="box">${it.checked && html`<${Icon} name="check" size=${13} />`}</span><span class="txt" dangerouslySetInnerHTML=${rich(it.text)}></span></li>`)}</ul>`;
    case 'quote': return html`<blockquote><div dangerouslySetInnerHTML=${rich(d.text)}></div>${d.caption && html`<cite dangerouslySetInnerHTML=${rich(d.caption)}></cite>`}</blockquote>`;
    case 'warning': return html`<div class="callout"><span class="icon"><${Icon} name="info" size=${18} /></span><div>${d.title && html`<b dangerouslySetInnerHTML=${rich(d.title)}></b>`}<div dangerouslySetInnerHTML=${rich(d.message)}></div></div></div>`;
    case 'delimiter': return html`<hr />`;
    case 'code': return html`<pre><code>${d.code}</code></pre>`;
    case 'table': {
      const rows = Array.isArray(d.content) ? d.content : [];
      const head = d.withHeadings && rows.length ? rows[0] : null;
      const body = head ? rows.slice(1) : rows;
      return html`<div style="overflow-x:auto"><table>${head && html`<thead><tr>${head.map((c, k) => html`<th key=${k} dangerouslySetInnerHTML=${rich(c)}></th>`)}</tr></thead>`}
        <tbody>${body.map((r, k) => html`<tr key=${k}>${(r || []).map((c, j) => html`<td key=${j} dangerouslySetInnerHTML=${rich(c)}></td>`)}</tr>`)}</tbody></table></div>`;
    }
    case 'drive': return d.file ? html`<${DriveBlock} file=${d.file} />` : null;
    default: return null;
  }
}

function List({ style, items, path, onToggleCheck }) {
  const check = style === 'checklist';
  const Tag = style === 'ordered' ? 'ol' : 'ul';
  const kids = items.map((it, k) => {
    const content = typeof it === 'string' ? it : it.content;
    const checked = !!it?.meta?.checked;
    const sub = Array.isArray(it?.items) && it.items.length ? html`<${List} style=${style} items=${it.items} path=${[...path, k]} onToggleCheck=${onToggleCheck} />` : null;
    if (!check) return html`<li key=${k}><span dangerouslySetInnerHTML=${rich(content)}></span>${sub}</li>`;
    return html`<li key=${k} class=${checked ? 'done' : ''} style="flex-wrap:wrap">
      ${onToggleCheck
        ? html`<button class="box" style="cursor:pointer;background:${checked ? 'var(--lime)' : 'none'}" aria-label=${checked ? 'Mark not done' : 'Mark done'} aria-pressed=${String(checked)} onClick=${() => onToggleCheck([...path, k])}>${checked && html`<${Icon} name="check" size=${13} />`}</button>`
        : html`<span class="box">${checked && html`<${Icon} name="check" size=${13} />`}</span>`}
      <span class="txt" style="flex:1" dangerouslySetInnerHTML=${rich(content)}></span>${sub && html`<div style="flex-basis:100%;padding-left:28px">${sub}</div>`}</li>`;
  });
  return Tag === 'ol' ? html`<ol>${kids}</ol>` : html`<ul class=${check ? 'checklist' : ''}>${kids}</ul>`;
}

// Flip one checklist item, addressed by [blockIndex, itemIndex, nestedIndex…].
export function toggleChecklist(content, path) {
  const c = JSON.parse(JSON.stringify(content || { blocks: [] }));
  const [bi, ...rest] = path;
  let items = c.blocks[bi]?.data?.items;
  let it;
  for (let i = 0; i < rest.length; i++) { it = items?.[rest[i]]; items = it?.items; }
  if (it) { it.meta = { ...(it.meta || {}), checked: !it.meta?.checked }; }
  return c;
}

export function DriveBlock({ file, folder }) {
  const [show, setShow] = useState(!!folder);
  const [kind, color] = kindOf(file.mimeType);
  const open = openUrl(file);
  const embed = embedUrl(file);
  const icon = typeof file.iconUrl === 'string' && /^https:\/\/[\w.-]+\.(googleusercontent|gstatic)\.com\//.test(file.iconUrl) ? file.iconUrl : null;
  return html`<div style="margin:10px 0">
    <div class="drive-card">
      ${icon ? html`<img src=${icon} alt="" referrerpolicy="no-referrer" />` : html`<span class="badge" style=${{ background: color, color: '#fff' }}>${kind.split(' ').pop()}</span>`}
      <div style="min-width:0;flex:1"><div class="name">${file.name || kind}</div><div class="kind">${kind} in Google Drive</div></div>
      ${file.demo ? html`<span class="small muted">Sample file</span>` : html`
        ${embed && !folder && html`<button class="btn btn-sm" onClick=${() => setShow(!show)} aria-expanded=${String(show)}>${show ? 'Hide preview' : 'Preview'}</button>`}
        ${open && html`<a class="btn btn-sm" href=${open} target="_blank" rel="noopener noreferrer"><${Icon} name="external" />Open</a>`}`}
    </div>
    ${show && embed && !file.demo && html`<iframe class=${'drive-frame' + (file.mimeType === 'application/vnd.google-apps.folder' ? ' folder' : '')} src=${embed} title=${'Preview of ' + (file.name || kind)}
      loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; fullscreen"></iframe>
      <p class="tiny muted" style="margin:4px 0 0">Not loading? Open it in Drive. You need access to the file in your Google account.</p>`}
    ${file.demo && show && html`<p class="tiny muted">Previews open here once the portal is connected to Google Drive.</p>`}
  </div>`;
}

// ───────── Editor.js tool: Google Drive file ─────────
const CLOUD_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5A4 4 0 0 1 17.5 18z"/></svg>';

class DriveTool {
  static get toolbox() { return { title: 'Google Drive file', icon: CLOUD_SVG }; }
  static get isReadOnlySupported() { return true; }
  constructor({ data, readOnly }) { this.data = data && data.file ? { file: data.file } : { file: null }; this.readOnly = readOnly; this.el = null; }
  render() { this.el = document.createElement('div'); this.el.className = 'er-drive-tool'; this.draw(); return this.el; }
  el_(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  draw() {
    const w = this.el; w.replaceChildren();
    if (this.data.file) {
      const f = this.data.file;
      const card = this.el_('div', 'drive-card');
      const [kind, color] = kindOf(f.mimeType);
      const badge = this.el_('span', 'badge', kind.split(' ').pop()); badge.style.background = color; badge.style.color = '#fff';
      const txt = this.el_('div'); txt.style.flex = '1'; txt.style.minWidth = '0';
      txt.append(this.el_('div', 'name', f.name || kind), this.el_('div', 'kind', kind + ' in Google Drive'));
      card.append(badge, txt);
      if (!this.readOnly) {
        const change = this.el_('button', 'btn btn-sm', 'Change'); change.type = 'button';
        change.onclick = () => { this.data = { file: null }; this.draw(); };
        card.append(change);
      }
      w.append(card);
      return;
    }
    const box = this.el_('div', 'pick');
    if (driveConfigured()) {
      const pick = this.el_('button', 'btn btn-sm btn-primary', 'Choose from Google Drive'); pick.type = 'button';
      pick.onclick = async () => {
        try { const [file] = await pickFromDrive(); if (file) { this.data = { file }; this.draw(); } }
        catch (e) { msg.textContent = e.userMessage || 'Google Drive didn’t open. Try pasting a link instead.'; }
      };
      box.append(pick, this.el_('span', 'small muted', 'or'));
    }
    const input = this.el_('input', 'input'); input.placeholder = 'Paste a Google Docs, Sheets, Slides or Drive link'; input.style.flex = '1'; input.style.minWidth = '220px';
    const add = this.el_('button', 'btn btn-sm', 'Add link'); add.type = 'button';
    const msg = this.el_('div', 'form-error tiny'); msg.style.flexBasis = '100%';
    const use = () => {
      const file = parseDriveLink(input.value);
      if (!file) { msg.textContent = 'That doesn’t look like a Google Drive link.'; return; }
      this.data = { file }; this.draw();
    };
    add.onclick = use;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); use(); } };
    input.onpaste = (e) => e.stopPropagation();
    box.append(input, add, msg);
    w.append(box);
  }
  save() { return this.data; }
  validate(saved) { return !!saved.file; }
}

// ───────── Editing ─────────
export function EditorHost({ content, onChange, onReady }) {
  const holder = useRef();
  const editorRef = useRef(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let dead = false;
    preloadDrive();
    (async () => {
      try {
        const m = await import('../../vendor/editor.js');
        if (dead) return;
        const editor = new m.EditorJS({
          holder: holder.current,
          data: cleanBlocks(content),
          autofocus: !(content?.blocks?.length),
          placeholder: 'Start writing. Click + or press Tab for headings, lists, checklists, tables and Google Drive files.',
          minHeight: 120,
          tools: {
            header: { class: m.Header, inlineToolbar: true, config: { levels: [2, 3, 4], defaultLevel: 2 } },
            list: { class: m.List, inlineToolbar: true, config: { defaultStyle: 'unordered' } },
            warning: { class: m.Warning, inlineToolbar: true, toolbox: { title: 'Callout' }, config: { titlePlaceholder: 'Heads up', messagePlaceholder: 'Details' } },
            quote: { class: m.Quote, inlineToolbar: true },
            table: { class: m.Table, inlineToolbar: true },
            code: { class: m.Code },
            delimiter: m.Delimiter,
            drive: { class: DriveTool },
            marker: { class: m.Marker },
            inlineCode: { class: m.InlineCode },
          },
          onChange: async () => {
            try { const data = await editor.save(); onChange && onChange({ blocks: data.blocks }); } catch (e) { console.warn(e); }
          },
        });
        await editor.isReady;
        if (dead) { editor.destroy?.(); return; }
        editorRef.current = editor;
        onReady && onReady(editor);
      } catch (e) { console.error(e); setError(e); }
    })();
    return () => { dead = true; try { editorRef.current?.destroy?.(); } catch { /* ignore */ } editorRef.current = null; };
  }, []);
  if (error) return html`<p class="form-error">The editor didn’t load. Reload the page and try again.</p>`;
  return html`<div class="editor-wrap prose" ref=${holder}></div>`;
}
