// The Crush Depth page's 3D stage background: rings of blue ASCII water spreading out from the ROV in the middle and
// dying away as they go. index.html starts it when the stage comes near the screen.
//
//   const waves = startRovWaves(stage)   waves.stop()
//
// The 3D viewer sends 'rov-view' events on the stage while the model moves: { x, y } is the model's centre as a
// share of the stage's width and height, r its size (see rov-viewer.js), and stir is true while someone is
// turning it, which churns the water.
// It only animates while on screen, in a visible tab and with motion allowed. Reduced motion or the page's
// pause button leave a still frame.

const RAMP = ' .:-~=+*#';
// Three brightnesses, so each row is three fillText calls rather than one per character
// in the club's blues: sky (#2CB5DE) for the swell, the deeper water blue (#1779B4) for the crests
const TIERS = [
  { from: 1, fill: 'rgba(44,181,222,.32)' },
  { from: 4, fill: 'rgba(44,181,222,.7)' },
  { from: 6, fill: 'rgba(23,121,180,.92)' },
];
const TAU = Math.PI * 2;
const RINGS = 4.2;      // rings per unit of radius (half the stage's short side)
const SPEED = 0.42;     // rings born per second
const CALM = 0.62;      // radius the rings start from, until the viewer says how big the ROV looks
const FADE = 0.9;       // how quickly they die away with distance
const FPS = 30;

export function startRovWaves(stage) {
  const canvas = document.createElement('canvas');
  canvas.className = 'rov-waves';
  canvas.setAttribute('aria-hidden', 'true');
  stage.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => reduce.matches || document.documentElement.classList.contains('motion-paused');

  let w = 0, h = 0, cols = 0, rows = 0, cw = 8, lh = 15, font = '';
  let cx = 0.5, cy = 0.5, tx = 0.5, ty = 0.5;   // ring centre, as a share of the stage, and where it's heading
  let calm = CALM, toCalm = CALM;
  let phase = 0, energy = 0, t = 0, last = 0, raf = 0, onScreen = false, stopped = false;

  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const size = w < 560 ? 11 : 13;
    font = `${size}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace'}`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = font;
    ctx.textBaseline = 'top';
    cw = ctx.measureText('0').width || size * 0.6;
    lh = Math.round(size * 1.18);
    cols = Math.ceil(w / cw); rows = Math.ceil(h / lh);
    return true;
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const s = Math.min(w, h) / 2;
    const ox = cx * w, oy = cy * h;
    const amp = 1 + 0.7 * energy;
    const lines = TIERS.map(() => new Array(cols));
    for (let j = 0; j < rows; j++) {
      const y = (j + 0.5) * lh;
      const dy = (y - oy) / s;
      for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) * cw;
        const dx = (x - ox) / s;
        const r = Math.sqrt(dx * dx + dy * dy);
        const a = Math.atan2(dy, dx);
        // Rings travelling outwards, wobbled a little around the circle, crossed by a fainter second set
        let v = Math.sin((r * RINGS - phase) * TAU + 0.7 * Math.sin(a * 3 + t * 0.3));
        v += 0.45 * Math.sin((r * RINGS * 0.62 - phase * 0.8) * TAU - a * 2);
        // Calm under the ROV, strongest just outside it, dying away beyond
        const rise = Math.min(1, Math.max(0, (r - calm) / 0.14));
        v *= rise * rise * Math.exp(-Math.max(0, r - calm) * FADE) * amp * 0.9;
        // A slow swell across the whole pool so the far water never goes completely flat
        v += 0.16 * Math.sin(x * 0.011 + t * 0.5) * Math.sin(y * 0.019 - t * 0.37);
        const k = v <= 0 ? 0 : Math.min(RAMP.length - 1, Math.floor(v * RAMP.length));
        const tier = k >= TIERS[2].from ? 2 : k >= TIERS[1].from ? 1 : k >= TIERS[0].from ? 0 : -1;
        for (let n = 0; n < 3; n++) lines[n][i] = n === tier ? RAMP[k] : ' ';
      }
      for (let n = 0; n < 3; n++) {
        ctx.fillStyle = TIERS[n].fill;
        ctx.fillText(lines[n].join(''), 0, j * lh);
      }
    }
  }

  function frame(now) {
    raf = 0;
    if (stopped || !onScreen || document.hidden || still()) { last = 0; return; }
    raf = requestAnimationFrame(frame);
    if (last && now - last < 1000 / FPS - 2) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    t += dt;
    phase += dt * SPEED * (1 + 1.6 * energy);
    energy *= Math.exp(-dt / 1.2);
    const ease = Math.min(1, dt * 8);
    cx += (tx - cx) * ease; cy += (ty - cy) * ease; calm += (toCalm - calm) * ease;
    draw();
  }
  function wake() {
    if (stopped) return;
    if (still() || document.hidden || !onScreen) {
      if (onScreen) { cx = tx; cy = ty; calm = toCalm; draw(); }   // a still frame, ripples where the ROV is
      return;
    }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function onView(e) {
    const d = e.detail || {};
    if (Number.isFinite(d.x) && Number.isFinite(d.y)) { tx = d.x; ty = d.y; }
    if (Number.isFinite(d.r) && d.r > 0) toCalm = Math.min(1.2, d.r * 0.62);
    if (d.stir) energy = Math.min(1, energy + 0.06);
    if (still()) wake();
  }
  stage.addEventListener('rov-view', onView);
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; wake(); });
  const ro = new ResizeObserver(() => { if (resize()) { draw(); wake(); } });
  const mo = new MutationObserver(wake);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  reduce.addEventListener?.('change', wake);
  document.addEventListener('visibilitychange', wake);

  // Draw with the site's mono face once it's ready, so the columns line up
  (document.fonts?.load ? document.fonts.load('13px "DM Mono"').catch(() => {}) : Promise.resolve()).then(() => {
    if (stopped) return;
    resize();
    io.observe(stage);
    ro.observe(stage);
  });

  return {
    canvas,
    stop() {
      stopped = true;
      cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect(); mo.disconnect();
      reduce.removeEventListener?.('change', wake);
      document.removeEventListener('visibilitychange', wake);
      stage.removeEventListener('rov-view', onView);
      canvas.remove();
    },
  };
}
