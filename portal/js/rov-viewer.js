// The Crush Depth page's interactive 3D ROV. index.html imports this only when someone presses
// "Explore in 3D", so three.js (portal/vendor/three.js) and the model never load otherwise.
//
//   const viewer = await mountRovViewer(stage, { src: 'rov.glb', rotate: [-90, 0, 0], onProgress })
//   viewer.reset()   viewer.dispose()
//
// Mouse: drag to turn, right-drag to move, Ctrl/⌘ + scroll (or a trackpad pinch) to zoom. Plain scrolling
// still scrolls the page, except in full screen, where it zooms. Touch: swipe sideways to turn, pinch to zoom; swiping up and down scrolls the page.
// Keyboard (canvas focused): arrows turn, + and - zoom, 0 resets.
// It turns slowly on its own until someone touches it (never with reduced motion or the animations paused),
// and it only draws while on screen and in a visible tab.
import {
  WebGLRenderer, Scene, PerspectiveCamera, Box3, Vector3, PMREMGenerator, ACESFilmicToneMapping, SRGBColorSpace,
  DirectionalLight, HemisphereLight, Group, Sphere, MathUtils, Spherical,
  GLTFLoader, OrbitControls, RoomEnvironment, MeshoptDecoder,
} from '../vendor/three.js';

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2')) || !!c.getContext('webgl');
  } catch { return false; }
}

export async function mountRovViewer(stage, { src, rotate = [0, 0, 0], onProgress = () => {} }) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const paused = () => reduce.matches || document.documentElement.classList.contains('motion-paused');

  // The model first, so a failed download leaves nothing half-built behind
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((resolve, reject) => loader.load(src, resolve,
    (e) => { if (e.total) onProgress(e.loaded / e.total); }, reject));

  const canvas = document.createElement('canvas');
  canvas.className = 'rov-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Interactive 3D model of the ROV. Use the arrow keys to turn it and plus or minus to zoom.');
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.6;
  pmrem.dispose();
  const key = new DirectionalLight(0xffffff, 1.2);
  key.position.set(3, 6, 4);
  scene.add(key, new HemisphereLight(0xe6f6ff, 0x16305e, 0.55));

  // Centre the model and turn it upright if the CAD export's axes differ from the web's (y up)
  const model = gltf.scene;
  model.rotation.set(...rotate.map((d) => MathUtils.degToRad(d)));
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  model.position.sub(box.getCenter(new Vector3()));
  const pivot = new Group();
  pivot.add(model);
  scene.add(pivot);
  const radius = box.getBoundingSphere(new Sphere()).radius;
  const dims = box.getSize(new Vector3());
  key.position.multiplyScalar(radius);

  const camera = new PerspectiveCamera(32, 1, radius / 100, radius * 40);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.8;
  controls.minDistance = radius * 0.5;
  controls.maxDistance = radius * 6;
  controls.autoRotateSpeed = 0.7;
  let autoTurn = true; // until the first touch
  canvas.style.touchAction = ''; // the stylesheet decides: pan-y on the page (swipes up and down scroll it), none in full screen

  // Frame it so it still fits as it turns: its footprint's radius across, and its height plus the
  // footprint seen from slightly above, top to bottom
  const VIEW = new Vector3(1, 0.5, 1.25).normalize();
  function fit() {
    const tanV = Math.tan(MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * camera.aspect;
    const across = Math.hypot(dims.x, dims.z) / 2;
    const tilt = Math.asin(VIEW.y);
    const tall = (dims.y / 2) * Math.cos(tilt) + across * Math.sin(tilt);
    const dist = Math.max(tall / tanV, across / tanH) + across * 0.35;
    camera.position.copy(VIEW).multiplyScalar(dist);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  let w = 0, h = 0, dirty = true, framed = false;
  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height || (r.width === w && r.height === h)) return;
    w = r.width; h = r.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!framed) { fit(); framed = true; }
    dirty = true;
  }

  // Zoom only with Ctrl/⌘ held (trackpad pinches send that too), so the page keeps scrolling past the model
  const hint = stage.querySelector('.rov-hint');
  let hintTimer = 0;
  function onWheel(e) {
    if (e.ctrlKey || e.metaKey || document.fullscreenElement === stage) return;
    e.stopImmediatePropagation();
    if (hint) {
      hint.dataset.flash = '1';
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { delete hint.dataset.flash; }, 1400);
    }
  }
  canvas.addEventListener('wheel', onWheel, { capture: true });

  // Keyboard: turn, tilt and zoom around the model
  const sph = new Spherical();
  const off = new Vector3();
  function nudge(dTheta, dPhi, scale) {
    off.copy(camera.position).sub(controls.target);
    sph.setFromVector3(off);
    sph.theta += dTheta;
    sph.phi = MathUtils.clamp(sph.phi + dPhi, 0.05, Math.PI - 0.05);
    sph.radius = MathUtils.clamp(sph.radius * scale, controls.minDistance, controls.maxDistance);
    off.setFromSpherical(sph);
    camera.position.copy(controls.target).add(off);
    controls.update();
  }
  function onKey(e) {
    const step = MathUtils.degToRad(e.shiftKey ? 45 : 15);
    const moves = {
      ArrowLeft: [-step, 0, 1], ArrowRight: [step, 0, 1], ArrowUp: [0, -step, 1], ArrowDown: [0, step, 1],
      '+': [0, 0, 0.85], '=': [0, 0, 0.85], '-': [0, 0, 1.18], _: [0, 0, 1.18],
    };
    if (e.key === '0' || e.key === 'Home') { api.reset(); e.preventDefault(); return; }
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    stopAutoTurn();
    kicked = true;
    nudge(...m);
  }
  canvas.addEventListener('keydown', onKey);

  function stopAutoTurn() { autoTurn = false; }
  let turning = false, kicked = false;
  controls.addEventListener('start', () => { stopAutoTurn(); turning = true; });
  controls.addEventListener('end', () => { turning = false; });
  controls.addEventListener('change', () => { dirty = true; });

  // Tell the stage where the model sits on screen, how big it looks and whether someone is moving it (the ASCII
  // water behind it, portal/js/rov-waves.js, ripples out from there). r is the model's footprint radius as a
  // share of half the stage's short side.
  const centre = new Vector3();
  function report() {
    centre.set(0, 0, 0).project(camera);
    const across = Math.hypot(dims.x, dims.z) / 2;
    const perPx = (h / 2) / (camera.position.distanceTo(controls.target) * Math.tan(MathUtils.degToRad(camera.fov) / 2));
    const r = (across * perPx) / (Math.min(w, h) / 2);
    stage.dispatchEvent(new CustomEvent('rov-view', { detail: { x: (centre.x + 1) / 2, y: (1 - centre.y) / 2, r, stir: turning || kicked } }));
    kicked = false;
  }

  // Draw only while on screen, in a visible tab, and something is moving
  let raf = 0, onScreen = true;
  function frame() {
    raf = 0;
    if (!onScreen || document.hidden) return;
    controls.autoRotate = autoTurn && !paused();
    if (controls.update()) dirty = true;
    if (dirty) { renderer.render(scene, camera); dirty = false; report(); }
    raf = requestAnimationFrame(frame);
  }
  const wake = () => { if (!raf && onScreen && !document.hidden) raf = requestAnimationFrame(frame); };
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; wake(); });
  const ro = new ResizeObserver(() => { resize(); wake(); });
  const onVisibility = () => wake();
  document.addEventListener('visibilitychange', onVisibility);

  stage.appendChild(canvas);
  resize();
  renderer.render(scene, camera);
  report();
  io.observe(stage);
  ro.observe(stage);
  wake();

  const api = {
    canvas,
    reset() { fit(); dirty = true; wake(); },
    snapshot(type = 'image/png') { renderer.render(scene, camera); return canvas.toDataURL(type); },
    dispose() {
      cancelAnimationFrame(raf);
      io.disconnect(); ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('wheel', onWheel, { capture: true });
      canvas.removeEventListener('keydown', onKey);
      controls.dispose();
      env.texture.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
  return api;
}
