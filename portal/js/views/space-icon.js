// Choosing a space's icon: an emoji, a picture someone uploads, or the plain # of a chat channel.
import { html, useState, useEffect, useRef, useMemo, Icon, Modal, openModal, Seg, EMOJIS } from '../lib/ui.js';
import { openPicture, makeIcon, firstEmoji, PICTURE_TYPES } from '../lib/picture.js';
import { SpaceIcon, hasOwnIcon } from './common.js';

// current: { name, private, icon, iconImage }. onPick gets { icon, iconImage } to save.
export function openIconPicker(current, onPick) {
  openModal((close) => html`<${IconPicker} current=${current} onPick=${onPick} close=${close} />`);
}

function IconPicker({ current, onPick, close }) {
  const [pic, setPic] = useState(null); // an opened picture, while choosing how it fits the square
  const [fit, setFit] = useState('fill');
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(), uploadBtn = useRef(), useBtn = useRef(), backBtn = useRef(), opened = useRef(false);
  const made = useMemo(() => {
    if (!pic) return { url: '', error: '' };
    try { return { url: makeIcon(pic, fit), error: '' }; } catch (e) { return { url: '', error: e.message }; }
  }, [pic, fit]);
  useEffect(() => () => pic?.done(), [pic]);
  // Moving between choosing and previewing: put focus on the next thing to press.
  useEffect(() => {
    if (!opened.current) { opened.current = true; return; }
    (pic ? (made.url ? useBtn.current : backBtn.current) : uploadBtn.current)?.focus();
  }, [!!pic]);

  const title = current.name ? `Icon for #${current.name}` : 'Choose an icon';
  const choose = (patch) => { onPick(patch); close(); };
  const useTyped = () => {
    const e = firstEmoji(typed);
    if (e) choose({ icon: e, iconImage: null });
    else setErr('Type or paste a single emoji, like 🦈.');
  };
  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again still counts
    if (!file) return;
    setErr(''); setBusy(true);
    try { const p = await openPicture(file); setFit('fill'); setPic(p); } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  if (pic) {
    return html`<${Modal} title=${title} onClose=${close}
      footer=${html`<button class="btn" ref=${backBtn} onClick=${() => setPic(null)}>Back</button>
        <button class="btn btn-primary" ref=${useBtn} disabled=${!made.url} onClick=${() => choose({ icon: '', iconImage: made.url })}>Use this picture</button>`}>
      <div class="icon-preview">
        ${made.url ? html`<img class="icon-preview-big" src=${made.url} alt="Your picture as the space’s icon" />` : html`<div class="icon-preview-big"></div>`}
        <div class="stack" style="gap:6px;min-width:0">
          <div class="icon-preview-rail" aria-hidden="true">${made.url && html`<${SpaceIcon} space=${{ iconImage: made.url }} />`}<span class="name">${current.name || 'new-space'}</span></div>
          <span class="small muted">In the sidebar</span>
        </div>
      </div>
      ${!pic.square && html`<div class="stack" style="gap:8px;margin-top:18px">
        <${Seg} label="How the picture fits the square" value=${fit} onChange=${setFit} options=${[['fill', 'Fill the square'], ['fit', 'Show all of it']]} />
        <p class="small muted" style="margin:0">${fit === 'fill' ? 'The edges are trimmed so the picture fills the square.' : 'The whole picture fits inside the square. The gaps stay see-through.'}</p>
      </div>`}
      ${made.error && html`<p class="form-error" role="alert">${made.error}</p>`}
    </${Modal}>`;
  }

  const own = hasOwnIcon(current);
  const at = Math.max(0, EMOJIS.indexOf(current.iconImage ? '' : current.icon));
  return html`<${Modal} title=${title} onClose=${close}
    footer=${html`${own && html`<button class="btn" onClick=${() => choose({ icon: '', iconImage: null })}><${Icon} name="hash" />Show # instead</button>`}
      <span class="spacer"></span><button class="btn" onClick=${close}>Cancel</button>`}>
    <div class="stack" style="gap:20px">
      <section aria-labelledby="ip-emoji">
        <h3 class="mini-head" id="ip-emoji">Emoji</h3>
        <div class="emoji-grid">${EMOJIS.map((e, i) => html`<button type="button" key=${e} autofocus=${i === at} aria-label=${'Use ' + e}
          aria-pressed=${String(!current.iconImage && current.icon === e)} onClick=${() => choose({ icon: e, iconImage: null })}>${e}</button>`)}</div>
        <div class="row" style="margin-top:10px">
          <input class="input" style="flex:1;min-width:0" value=${typed} maxlength="32" aria-label="Or type any emoji" placeholder="Or type any emoji"
            onInput=${(e) => { setTyped(e.target.value); setErr(''); }} onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); useTyped(); } }} />
          <button type="button" class="btn" disabled=${!typed.trim()} onClick=${useTyped}>Use it</button>
        </div>
      </section>
      <section aria-labelledby="ip-pic">
        <h3 class="mini-head" id="ip-pic">Your own picture</h3>
        <div class="row wrap" style="gap:10px 14px">
          <button type="button" class="btn" ref=${uploadBtn} disabled=${busy} onClick=${() => fileRef.current?.click()}><${Icon} name="upload" />${busy ? 'Opening…' : 'Upload a picture'}</button>
          <span class="small muted" style="flex:1;min-width:190px">PNG, JPG, WebP, GIF or SVG. Logos and simple pictures read best this small.</span>
        </div>
        <input ref=${fileRef} type="file" accept=${PICTURE_TYPES} hidden onChange=${onFile} />
      </section>
      ${err && html`<p class="form-error" role="alert" style="margin:0">${err}</p>`}
    </div>
  </${Modal}>`;
}
