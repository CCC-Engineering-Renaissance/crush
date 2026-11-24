// The sign-in page's art: the club's bull logo drawn in ASCII characters (js/art/engine.js).
// Streams of characters drift through the bull toward a dotted "portal" line, and the things
// members do in the portal light up beside it as they arrive.
import { html, useEffect, useRef, useState, Icon } from '../lib/ui.js';
import { createAsciiArt } from '../art/engine.js';
import BULL from '../art/bull-map.js';

const LABELS = ['hours logged', 'doc linked', 'task done', 'event added', 'news posted'];

function useReducedMotion() {
  const query = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [reduce, setReduce] = useState(!!(query && query.matches));
  useEffect(() => {
    if (!query?.addEventListener) return undefined;
    const on = () => setReduce(query.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, []);
  return reduce;
}

export function BullArt() {
  const wrap = useRef(null);
  const canvas = useRef(null);
  const art = useRef(null);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!window.ResizeObserver || !window.IntersectionObserver) return undefined;
    art.current = createAsciiArt(wrap.current, canvas.current, { key: 'gate', layout: 'gate', labels: LABELS, logos: [{ map: BULL, effect: 'steam' }] });
    return () => art.current && art.current.destroy();
  }, []);
  useEffect(() => { art.current && art.current.setPaused(paused); }, [paused]);
  return html`<div class="gate-art" ref=${wrap}>
    <canvas ref=${canvas} aria-hidden="true"></canvas>
    ${!reduce && html`<button type="button" class="art-pause" aria-pressed=${String(paused)} title=${paused ? 'Play the animation' : 'Pause the animation'}
      onClick=${() => setPaused(!paused)}><${Icon} name=${paused ? 'play' : 'pause'} size=${14} /><span class="sr-only">Pause the animation</span></button>`}
  </div>`;
}
