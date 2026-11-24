// ASCII art engine for the club's logos, shared by the portal's sign-in screens and the
// public site. No framework: give it a box, a canvas and a scene.
//
//   createAsciiArt(box, canvas, { layout, logos, labels, key, flow })
//
// layout  'gate'  one logo, then a dotted "portal" line with labels that light up (sign-in)
//         'pair'  logos side by side at equal height, each named underneath (public home)
//         'solo'  one logo centred (Crush Depth page)
// logos   [{ map, effect: 'steam' | 'ripple', name, note }]  (maps from bull-map.js, crush-map.js)
// flow    'right' (streams of characters, default) or 'up' (bubbles)
//
// Colours come from CSS custom properties on the box: --art-stream, --art-light, --art-grey,
// --art-ink, --art-green, --art-blue, --art-hot, --art-hot-2, --art-label, --art-name, --art-line.
// The logos resolve from noise once per page load; after that the loop stays quiet. Everything
// stands still under prefers-reduced-motion, and nothing is drawn while the tab is hidden, the
// box is off screen, or the art is paused.

const RAMP = ' .:-=+*#%@';
const TONE = [0, 0, 0.34, 0.58, 1, 0.86, 0.86]; // ink per class (see the map files)
const CLASS_COLOR = [null, null, '--art-light', '--art-grey', '--art-ink', '--art-green', '--art-blue'];
const COLOR_VARS = ['--art-stream', '--art-light', '--art-grey', '--art-ink', '--art-green', '--art-blue', '--art-hot', '--art-hot-2', '--art-label', '--art-name', '--art-line'];
const MONO = '"DM Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';
const INTRO = 1.6; // seconds until the logos have resolved and the labels are in
const played = new Set(); // scenes whose intro already ran on this page load

const decodedMaps = new Map();
function decode(map) {
  let grid = decodedMaps.get(map);
  if (grid) return grid;
  grid = new Uint8Array(map.w * map.h);
  let i = 0;
  for (const run of map.rle.split(',')) {
    const n = run.length > 1 ? parseInt(run.slice(1), 36) : 1;
    grid.fill(+run[0], i, i + n);
    i += n;
  }
  decodedMaps.set(map, grid);
  return grid;
}

// Average the classes under each character cell. How much ink a cell holds picks the
// character; the strongest class picks the colour (thin black and coloured outlines win).
function sampleLogo(map, cols, rows) {
  const g = decode(map);
  const ch = new Uint8Array(cols * rows);
  const cl = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor((cy * map.h) / rows);
    const y1 = Math.max(Math.floor(((cy + 1) * map.h) / rows), y0 + 1);
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * map.w) / cols);
      const x1 = Math.max(Math.floor(((cx + 1) * map.w) / cols), x0 + 1);
      const counts = [0, 0, 0, 0, 0, 0, 0];
      let n = 0;
      let tone = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) { const k = g[y * map.w + x]; counts[k]++; tone += TONE[k]; n++; }
      }
      tone /= n;
      if (tone < 0.06) continue;
      let dom = 0;
      let best = 0;
      for (let k = 2; k <= 6; k++) { const w = counts[k] * (k >= 4 ? 1.6 : 1); if (w > best) { best = w; dom = k; } }
      if (!dom) continue;
      ch[cy * cols + cx] = Math.min(9, Math.max(1, Math.round(tone * 9)));
      cl[cy * cols + cx] = dom;
    }
  }
  return { ch, cl };
}

export function createAsciiArt(box, canvas, scene) {
  const ctx = canvas.getContext('2d');
  const layout = scene.layout || 'gate';
  const logos = scene.logos || [];
  const labels = scene.labels || [];
  const flow = scene.flow || 'right';
  const key = scene.key || layout;
  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const reduced = () => !!(reduceQuery && reduceQuery.matches);
  const st = {
    W: 0, H: 0, dpr: 1, fs: 11, lfs: 12, cw: 7, chh: 14, cols: 0, rows: 0,
    L: null, placed: [], owner: null, ownerIdx: null, colors: {}, layer: null,
    drifters: [], packets: [], labelState: labels.map(() => ({ flash: 0, done: false })),
    clock: 0, nextPacket: 0.4, nextLabel: 0, packetColor: 0, spark: null,
    raf: 0, last: 0, running: false, paused: false, visible: true, ready: false,
    intro: !played.has(key) && !reduced(),
  };
  played.add(key);
  if (!st.intro) st.clock = INTRO + 1;

  const font = (size, weight = 400) => `${weight} ${size}px ${MONO}`;
  const color = (name) => st.colors[name] || '#888';

  function readColors() {
    const cs = getComputedStyle(box);
    for (const name of COLOR_VARS) st.colors[name] = cs.getPropertyValue(name).trim();
    if (!st.colors['--art-hot-2']) st.colors['--art-hot-2'] = st.colors['--art-hot'];
    if (!st.colors['--art-name']) st.colors['--art-name'] = st.colors['--art-ink'];
  }

  function measure(fs, lfs) {
    st.fs = fs;
    st.lfs = lfs;
    ctx.font = font(fs);
    st.cw = ctx.measureText('0').width || fs * 0.6;
    st.chh = st.cw * 2; // cells twice as tall as wide keep the logos' proportions
    st.cols = Math.max(10, Math.floor(st.W / st.cw));
    st.rows = Math.max(6, Math.floor(st.H / st.chh));
  }

  function place(logo, lx, ly, lc, lr) {
    lc = Math.max(4, lc);
    lr = Math.max(3, lr);
    return {
      ...logo, lx, ly, lc, lr, ...sampleLogo(logo.map, lc, lr),
      jitter: new Float32Array(lc * lr).map(() => Math.random()),
      mid: lx + lc / 2,
    };
  }

  function layoutGate() {
    const { W } = st;
    measure(W >= 1000 ? 12 : W >= 600 ? 11 : 8.5, W >= 600 ? 12 : 11);
    const wide = W >= 560;
    ctx.font = font(st.lfs, 500);
    const labelPx = Math.max(0, ...labels.map((l) => ctx.measureText(`${l} ✓`).width));
    const labelCols = wide ? Math.ceil(labelPx / st.cw) + 1 : 0;
    const map = logos[0].map;
    let lc = st.cols - (wide ? labelCols + 6 + 4 : 2);
    let lr = Math.round((lc * map.h) / map.w / 2);
    const maxRows = st.rows - (wide ? 7 : 2);
    if (lr > maxRows) { lr = maxRows; lc = Math.round((lr * 2 * map.w) / map.h); }
    const lx = wide ? 1 : Math.floor((st.cols - lc) / 2);
    const ly = Math.floor((st.rows - lr) / 2);
    const lineCol = wide ? st.cols - labelCols - 2 : st.cols;
    const mid = ly + Math.round(lr / 2);
    const step = st.rows >= 34 ? 3 : 2;
    st.placed = [place(logos[0], lx, ly, lc, lr)];
    st.L = {
      wide, lineCol, end: wide ? lineCol - 1 : st.cols, bandTop: ly - 1, bandRows: lr + 2,
      labelRows: labels.map((_, i) => mid + (i - (labels.length - 1) / 2) * step).map(Math.round),
    };
  }

  // Side by side at one height, so the two logos read as a pair.
  function layoutPair() {
    const { W } = st;
    measure(W >= 1100 ? 10 : W >= 700 ? 9 : W >= 480 ? 7.5 : 6, W >= 700 ? 12 : 10.5);
    const named = logos.some((l) => l.name);
    const below = named ? 5 : 1;
    const gap = Math.max(4, Math.round(st.cols * 0.05));
    const avail = st.cols - 2 - gap * (logos.length - 1);
    const aspects = logos.map((l) => (2 * l.map.w) / l.map.h);
    const sumA = aspects.reduce((a, b) => a + b, 0);
    const H = Math.max(6, Math.min(st.rows - below - 2, Math.floor(avail / sumA)));
    const widths = aspects.map((a) => Math.round(a * H));
    const total = widths.reduce((a, b) => a + b, 0) + gap * (logos.length - 1);
    const top = Math.max(1, Math.floor((st.rows - H - below) / 2));
    let x = Math.floor((st.cols - total) / 2);
    st.placed = logos.map((logo, i) => { const p = place(logo, x, top, widths[i], H); x += widths[i] + gap; return p; });
    st.L = { wide: false, end: st.cols, bandTop: top - 1, bandRows: H + 2, nameRow: top + H + 1.7 };
  }

  function layoutSolo() {
    const { W } = st;
    measure(W >= 600 ? 9 : 7, 11);
    const map = logos[0].map;
    const a = (2 * map.w) / map.h;
    let H = st.rows - 2;
    let wc = Math.round(a * H);
    if (wc > st.cols - 2) { wc = st.cols - 2; H = Math.round(wc / a); }
    const lx = Math.floor((st.cols - wc) / 2);
    const ly = Math.floor((st.rows - H) / 2);
    st.placed = [place(logos[0], lx, ly, wc, H)];
    st.L = { wide: false, end: st.cols, bandTop: ly - 1, bandRows: H + 2 };
  }

  // Which logo cell (if any) sits under each screen cell.
  function indexCells() {
    const n = st.cols * st.rows;
    st.owner = new Int8Array(n).fill(-1);
    st.ownerIdx = new Int32Array(n);
    st.placed.forEach((p, k) => {
      for (let cy = 0; cy < p.lr; cy++) {
        const row = p.ly + cy;
        if (row < 0 || row >= st.rows) continue;
        for (let cx = 0; cx < p.lc; cx++) {
          const col = p.lx + cx;
          const i = cy * p.lc + cx;
          if (col < 0 || col >= st.cols || !p.cl[i]) continue;
          st.owner[row * st.cols + col] = k;
          st.ownerIdx[row * st.cols + col] = i;
        }
      }
    });
  }

  function cellAt(col, row) {
    if (col < 0 || row < 0 || col >= st.cols || row >= st.rows) return null;
    const k = st.owner[row * st.cols + col];
    return k < 0 ? null : { p: st.placed[k], i: st.ownerIdx[row * st.cols + col] };
  }

  function respawn(d, scatter) {
    const { L } = st;
    if (flow === 'up') {
      d.x = Math.random() * st.cols;
      d.y = scatter ? Math.random() * st.rows : st.rows + Math.random() * 6;
      d.speed = 1.2 + Math.random() * 3.2;
      d.size = Math.random();
      d.phase = Math.random() * 6.28;
      return;
    }
    // Most streams run through the logos' band; a few drift above and below it.
    d.row = Math.random() < 0.75
      ? Math.max(0, L.bandTop) + Math.floor(Math.random() * L.bandRows)
      : Math.floor(Math.random() * st.rows);
    d.len = 3 + Math.floor(Math.random() * 11);
    d.peak = 3 + Math.floor(Math.random() * 4);
    d.speed = 4 + Math.random() * 10;
    d.x = scatter ? Math.random() * (L.end + d.len) : -Math.random() * 24;
  }

  function seedDrifters() {
    const per = flow === 'up' ? 0.9 : layout === 'gate' && st.L.wide ? 1.3 : 1.1;
    const count = Math.round(st.rows * per);
    st.drifters = Array.from({ length: count }, () => { const d = {}; respawn(d, true); return d; });
    st.packets = [];
  }

  // The resolved logos, drawn once per size and theme; each frame copies them.
  function buildLayer() {
    const layer = document.createElement('canvas');
    layer.width = canvas.width;
    layer.height = canvas.height;
    const c = layer.getContext('2d');
    c.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    c.font = font(st.fs);
    c.textBaseline = 'middle';
    for (let k = 2; k <= 6; k++) {
      c.fillStyle = color(CLASS_COLOR[k]);
      for (const p of st.placed) {
        for (let i = 0; i < p.ch.length; i++) {
          if (p.cl[i] !== k) continue;
          const cx = i % p.lc;
          const cy = (i - cx) / p.lc;
          c.fillText(RAMP[p.ch[i]], (p.lx + cx) * st.cw, (p.ly + cy) * st.chh + st.chh / 2);
        }
      }
    }
    st.layer = layer;
  }

  function resize() {
    const r = box.getBoundingClientRect();
    const W = Math.round(r.width);
    const H = Math.round(r.height);
    if (!W || !H) return;
    st.W = W; st.H = H;
    st.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * st.dpr);
    canvas.height = Math.round(H * st.dpr);
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    readColors();
    if (layout === 'pair') layoutPair();
    else if (layout === 'solo') layoutSolo();
    else layoutGate();
    indexCells();
    seedDrifters();
    buildLayer();
    st.ready = true;
    draw();
  }

  function glyph(chr, col, row, fill, alpha = 1, clear = false) {
    const x = col * st.cw;
    const y = row * st.chh;
    if (clear) ctx.clearRect(x, y, st.cw, st.chh);
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fillText(chr, x, y + st.chh / 2);
    if (alpha !== 1) ctx.globalAlpha = 1;
  }

  function drawLogos(t) {
    if (t >= INTRO) { ctx.drawImage(st.layer, 0, 0, st.W, st.H); return; }
    // Intro: each cell flickers through random characters, then settles, left to right.
    for (const p of st.placed) {
      for (let i = 0; i < p.ch.length; i++) {
        if (!p.cl[i]) continue;
        const cx = i % p.lc;
        const cy = (i - cx) / p.lc;
        const settle = 0.12 + ((p.lx + cx) / st.cols) * 0.8 + p.jitter[i] * 0.3;
        const fill = color(CLASS_COLOR[p.cl[i]]);
        if (t >= settle) glyph(RAMP[p.ch[i]], p.lx + cx, p.ly + cy, fill);
        else if (t >= settle - 0.4) glyph(RAMP[1 + Math.floor(Math.random() * 9)], p.lx + cx, p.ly + cy, fill, 0.5);
      }
    }
  }

  // Logo-specific life: the bull's steam billows outward; Crush Depth's ring ripples like water.
  function drawEffects(t) {
    if (t < INTRO) return;
    for (const p of st.placed) {
      if (p.effect === 'steam') {
        const fill = color('--art-light');
        for (let i = 0; i < p.ch.length; i++) {
          if (p.cl[i] !== 2) continue;
          const cx = i % p.lc;
          const cy = (i - cx) / p.lc;
          const out = p.lx + cx < p.mid ? 1 : -1;
          const wave = Math.sin(cx * 0.55 + out * t * 2.2 + cy * 0.9);
          const d = wave > 0.6 ? 1 : wave < -0.6 ? -1 : 0;
          if (d) glyph(RAMP[Math.min(9, Math.max(1, p.ch[i] + d))], p.lx + cx, p.ly + cy, fill, 1, true);
        }
      } else if (p.effect === 'ripple') {
        const hx = p.lc / 2;
        const hy = p.lr * 0.62;
        for (let i = 0; i < p.ch.length; i++) {
          const k = p.cl[i];
          if (k !== 6 && k !== 5) continue;
          const cx = i % p.lc;
          const cy = (i - cx) / p.lc;
          const dist = Math.hypot(cx - hx, (cy - hy) * 2);
          const wave = Math.sin(dist * 0.42 - t * 2.1);
          const d = wave > 0.72 ? 1 : wave < -0.72 ? -1 : 0;
          if (d) glyph(RAMP[Math.min(9, Math.max(1, p.ch[i] + d))], p.lx + cx, p.ly + cy, color(CLASS_COLOR[k]), 1, true);
        }
      }
    }
  }

  function drawDrifters(t) {
    const { L } = st;
    const stream = color('--art-stream');
    if (flow === 'up') {
      for (const d of st.drifters) {
        const col = Math.round(d.x + Math.sin(t * 1.4 + d.phase) * 0.6);
        const row = Math.floor(d.y);
        const hit = cellAt(col, row);
        if (hit) {
          if (st.clock >= INTRO) glyph(RAMP[Math.min(9, hit.p.ch[hit.i] + 2)], col, row, color(CLASS_COLOR[hit.p.cl[hit.i]]), 1, true);
          continue;
        }
        glyph(d.size > 0.82 ? 'O' : d.size > 0.45 ? 'o' : '.', col, row, stream);
      }
      return;
    }
    for (const d of st.drifters) {
      const head = Math.floor(d.x);
      for (let j = 0; j < d.len; j++) {
        const col = head - j;
        if (col < 0 || col > L.end) continue;
        const hit = cellAt(col, d.row);
        if (hit) {
          // Passing through a logo: its characters thicken for a moment (after the intro).
          if (j < 3 && st.clock >= INTRO) glyph(RAMP[Math.min(9, hit.p.ch[hit.i] + 2)], col, d.row, color(CLASS_COLOR[hit.p.cl[hit.i]]), 1, true);
          continue;
        }
        const idx = 1 + Math.round((1 - j / d.len) * d.peak);
        glyph(RAMP[Math.min(9, idx)], col, d.row, stream);
      }
    }
  }

  function drawPackets() {
    for (const p of st.packets) {
      const head = Math.floor(p.x);
      const fill = color(p.hot);
      for (let j = 0; j < 8; j++) {
        const col = head - j;
        if (col < 0 || col >= p.stop) continue;
        glyph(RAMP[Math.max(1, 9 - j)], col, p.row, fill, 1 - j / 9, !!cellAt(col, p.row));
      }
    }
  }

  function drawGateLine(t) {
    const { L } = st;
    if (layout !== 'gate' || !L.wide) return;
    const x = L.lineCol * st.cw + st.cw / 2;
    const top = 2.6 * st.chh;
    const bottom = (st.rows - 1) * st.chh;
    const grow = Math.min(1, Math.max(0, (t - 0.45) / 0.7));
    const end = top + (bottom - top) * grow;
    ctx.fillStyle = color('--art-line');
    for (let y = top; y <= end; y += 5) ctx.fillRect(x - 0.75, y, 1.5, 1.5);
    if (st.spark) {
      ctx.globalAlpha = Math.min(1, st.spark.t / 0.35);
      ctx.fillStyle = color('--art-hot');
      const y0 = st.spark.row * st.chh;
      for (let y = y0 - 5; y <= y0 + st.chh + 5; y += 5) ctx.fillRect(x - 1.25, y, 2.5, 2.5);
      ctx.globalAlpha = 1;
    }
    ctx.font = font(st.lfs, 500);
    ctx.fillStyle = color('--art-label');
    ctx.globalAlpha = grow;
    ctx.textAlign = 'center';
    ctx.fillText('portal', x, 1.5 * st.chh);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  function drawLabels(t) {
    const { L } = st;
    if (layout === 'gate' && L.wide) {
      ctx.font = font(st.lfs, 500);
      const x = (L.lineCol + 2) * st.cw;
      st.labelState.forEach((lb, i) => {
        const appear = Math.min(1, Math.max(0, (t - 0.9 - i * 0.08) / 0.4));
        if (!appear) return;
        const y = L.labelRows[i] * st.chh + st.chh / 2;
        const text = lb.done ? `${labels[i]} ✓` : labels[i];
        ctx.globalAlpha = appear;
        ctx.fillStyle = color('--art-label');
        ctx.fillText(text, x, y);
        if (lb.flash > 0) {
          ctx.globalAlpha = appear * lb.flash;
          ctx.fillStyle = color('--art-hot');
          ctx.fillText(text, x, y);
        }
      });
      ctx.globalAlpha = 1;
    }
    if (layout === 'pair') {
      const appear = Math.min(1, Math.max(0, (t - 1.0) / 0.5));
      if (!appear) return;
      ctx.textAlign = 'center';
      ctx.globalAlpha = appear;
      for (const p of st.placed) {
        if (!p.name) continue;
        const x = (p.lx + p.lc / 2) * st.cw;
        const y = L.nameRow * st.chh;
        ctx.font = font(st.lfs, 500);
        ctx.fillStyle = color('--art-name');
        ctx.fillText(p.name, x, y);
        if (p.note) {
          ctx.font = font(st.lfs - 1);
          ctx.fillStyle = color('--art-label');
          ctx.fillText(p.note, x, y + st.lfs * 1.6);
        }
      }
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    if (!st.ready) return;
    ctx.clearRect(0, 0, st.W, st.H);
    ctx.font = font(st.fs);
    ctx.textBaseline = 'middle';
    const t = st.clock;
    drawLogos(t);
    drawEffects(t);
    drawDrifters(t);
    drawPackets();
    ctx.font = font(st.fs);
    drawGateLine(t);
    drawLabels(t);
  }

  function launch() {
    const { L } = st;
    if (layout === 'gate') {
      const i = st.nextLabel;
      st.nextLabel = (i + 1) % labels.length;
      const p = st.placed[0];
      // Each one leaves from the bull's right-hand cloud of steam.
      st.packets.push({ row: L.labelRows[i], label: i, x: p.lx + Math.round(p.lc * 0.8), speed: 15 + Math.random() * 5, stop: L.lineCol, hot: '--art-hot' });
      return;
    }
    // Elsewhere a bright streak crosses the whole picture now and then, in alternating colours.
    st.packetColor = 1 - st.packetColor;
    const row = Math.max(0, L.bandTop) + 1 + Math.floor(Math.random() * Math.max(1, L.bandRows - 2));
    st.packets.push({ row, label: -1, x: -2, speed: 26 + Math.random() * 10, stop: st.cols, hot: st.packetColor ? '--art-hot' : '--art-hot-2' });
  }

  function step(dt) {
    const { L } = st;
    st.clock += dt;
    for (const d of st.drifters) {
      if (flow === 'up') { d.y -= d.speed * dt; if (d.y < -1) respawn(d, false); }
      else { d.x += d.speed * dt; if (d.x - d.len > L.end) respawn(d, false); }
    }
    if (st.clock < INTRO || flow === 'up') return;
    if (layout === 'gate' && !L.wide) return;
    st.nextPacket -= dt;
    if (st.nextPacket <= 0) { launch(); st.nextPacket = layout === 'gate' ? 1.4 + Math.random() * 1.2 : 1.6 + Math.random() * 1.6; }
    const keep = [];
    for (const p of st.packets) {
      p.x += p.speed * dt;
      if (p.label >= 0 && p.x >= p.stop) {
        // Arrived at the portal line: its label lights up and keeps a check mark.
        st.labelState[p.label].flash = 1;
        st.labelState[p.label].done = true;
        st.spark = { row: p.row, t: 0.35 };
      } else if (p.x - 8 < p.stop) keep.push(p);
    }
    st.packets = keep;
    for (const lb of st.labelState) lb.flash = Math.max(0, lb.flash - dt / 1.6);
    if (st.spark) { st.spark.t -= dt; if (st.spark.t <= 0) st.spark = null; }
  }

  function frame(now) {
    if (!st.running) return;
    st.raf = requestAnimationFrame(frame);
    const elapsed = now - st.last;
    if (elapsed < 48) return; // about 20 frames a second is plenty for drifting characters
    st.last = now;
    step(Math.min(0.1, elapsed / 1000));
    draw();
  }

  function settle() {
    // Reduced motion: the finished picture, standing still.
    st.clock = Math.max(st.clock, INTRO + 1);
    for (const lb of st.labelState) { lb.done = true; lb.flash = 0; }
    st.packets = [];
    draw();
  }

  function sync() {
    const go = st.ready && !st.paused && st.visible && !document.hidden && !reduced();
    if (go && !st.running) { st.running = true; st.last = performance.now(); st.raf = requestAnimationFrame(frame); }
    if (!go && st.running) { st.running = false; cancelAnimationFrame(st.raf); }
    if (st.ready && reduced()) settle();
  }

  let pendingResize = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(pendingResize);
    pendingResize = requestAnimationFrame(() => { resize(); sync(); });
  });
  const io = new IntersectionObserver(([e]) => { st.visible = e.isIntersecting; sync(); });
  const mo = new MutationObserver(() => { if (!st.ready) return; readColors(); buildLayer(); draw(); });
  const onVisibility = () => sync();
  const onMotion = () => sync();

  let alive = true;
  const fontReady = document.fonts && document.fonts.load
    ? Promise.race([document.fonts.load(font(12)), new Promise((r) => setTimeout(r, 800))]).catch(() => {})
    : Promise.resolve();
  fontReady.then(() => {
    if (!alive) return;
    resize();
    ro.observe(box);
    io.observe(box);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    document.addEventListener('visibilitychange', onVisibility);
    if (reduceQuery && reduceQuery.addEventListener) reduceQuery.addEventListener('change', onMotion);
    sync();
  });

  return {
    setPaused(p) { st.paused = p; sync(); },
    destroy() {
      alive = false;
      st.running = false;
      cancelAnimationFrame(st.raf);
      cancelAnimationFrame(pendingResize);
      ro.disconnect(); io.disconnect(); mo.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (reduceQuery && reduceQuery.removeEventListener) reduceQuery.removeEventListener('change', onMotion);
    },
  };
}
