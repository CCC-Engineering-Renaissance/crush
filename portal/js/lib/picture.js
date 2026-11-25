// Turns a picture someone uploads into a small square icon. The result is text (a data: URL)
// kept in the space's own document, so the portal needs no file storage.
export const ICON_PX = 128;
export const PICTURE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';
const MAX_FILE = 15 * 1024 * 1024;
export const MAX_ICON_CHARS = 48000; // firestore.rules allows 50,000

// Opens the file as a picture. Call done() when finished with it.
export async function openPicture(file) {
  if (!/^image\//.test(file?.type || '')) throw new Error('Choose a picture: a PNG, JPG, WebP, GIF or SVG file.');
  if (file.size > MAX_FILE) throw new Error('That picture is over 15 MB. Choose a smaller one.');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch {
    URL.revokeObjectURL(url);
    throw new Error('That file couldn’t be opened as a picture. Try a PNG or JPG.');
  }
  // An SVG with no size of its own reports 0: treat it as square.
  const w = img.naturalWidth || 512, h = img.naturalHeight || 512;
  return { img, w, h, square: Math.abs(w / h - 1) < 0.04, done: () => URL.revokeObjectURL(url) };
}

// fit 'fill' crops to the middle square; 'fit' shrinks the whole picture into the square and
// leaves the rest see-through. Steps down in size until it fits what the rules allow.
export function makeIcon(pic, fit = 'fill') {
  for (const px of [ICON_PX, 96, 64]) {
    let url;
    try { url = encode(draw(pic, fit, px)); } catch { throw new Error('That picture couldn’t be used. Try saving it as a PNG or JPG first.'); }
    if (url.length <= MAX_ICON_CHARS) return url;
  }
  throw new Error('That picture has too much detail to use as an icon. Try a simpler one, like a logo.');
}

const blank = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

function draw({ img, w, h }, fit, px) {
  let sx = 0, sy = 0, sw = w, sh = h, dx = 0, dy = 0, dw = px, dh = px;
  if (fit === 'fill') {
    const side = Math.min(w, h);
    sx = (w - side) / 2; sy = (h - side) / 2; sw = sh = side;
  } else {
    const s = px / Math.max(w, h);
    dw = Math.max(1, Math.round(w * s)); dh = Math.max(1, Math.round(h * s));
    dx = Math.floor((px - dw) / 2); dy = Math.floor((px - dh) / 2);
  }
  // Shrink by halves (at most 2048 px to start) so a big photo stays smooth instead of grainy.
  let src = img, x = sx, y = sy, cw = sw, ch = sh;
  while (cw > dw * 2 || ch > dh * 2) {
    const f = Math.max(cw, ch) > 2048 ? 2048 / Math.max(cw, ch) : 0.5;
    const step = blank(Math.max(dw, Math.round(cw * f)), Math.max(dh, Math.round(ch * f)));
    step.getContext('2d').drawImage(src, x, y, cw, ch, 0, 0, step.width, step.height);
    src = step; x = 0; y = 0; cw = step.width; ch = step.height;
  }
  const out = blank(px, px);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, x, y, cw, ch, dx, dy, dw, dh);
  return out;
}

function encode(c) {
  const webp = c.toDataURL('image/webp', 0.9);
  if (webp.startsWith('data:image/webp')) return webp;
  // Browsers that can't write WebP (Safari): PNG keeps see-through parts, JPEG is smaller for photos.
  return opaque(c) ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png');
}

function opaque(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return false;
  return true;
}

// Only pictures made here (PNG, JPEG or WebP data: URLs) are shown, never links to other sites.
export const isIconImage = (v) => typeof v === 'string' && v.length <= 50000 && /^data:image\/(png|jpeg|webp);base64,/.test(v);

// The first emoji in some text. Flags and emoji joined together count as one.
export function firstEmoji(text) {
  const t = (text || '').trim();
  if (!t) return '';
  const first = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)[Symbol.iterator]().next().value?.segment
    : Array.from(t)[0];
  return first && first.length <= 32 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(first) ? first : '';
}
