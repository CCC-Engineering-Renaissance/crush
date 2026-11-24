// Charts: a ranked bar list and a column chart over time (optionally stacked).
// Marks follow the dataviz spec: thin bars, 4px rounded data ends, 2px gaps, hairline grid,
// hover + keyboard tooltips, legends for two or more series.
import { html, useState, useRef, useEffect } from '../lib/ui.js';
import { fmtHours } from '../lib/time.js';

export const PALETTE_KEYS = ['lime', 'sky', 'orange', 'navy', 'magenta', 'gold'];
export function seriesColor(key) {
  if (!key) return 'var(--series-other)';
  if (PALETTE_KEYS.includes(key) || key === 'other') return `var(--series-${key})`;
  return key; // legacy hex
}

// Horizontal bars, one row per group (members, activities, subteams…). Value at the bar tip.
export function BarList({ rows, unit = 'h', max, color = 'navy', onRowClick, valueLabel }) {
  const top = max ?? Math.max(1e-9, ...rows.map((r) => r.value));
  return html`<div class="barlist" role="list">
    ${rows.map((r) => {
      const pct = Math.max(0.6, (r.value / top) * 100);
      const c = seriesColor(r.color || color);
      const label = valueLabel ? valueLabel(r) : `${fmtHours(r.value)} ${unit}`;
      return html`<div class="row-hit" role="listitem" key=${r.key} tabindex=${onRowClick ? 0 : -1}
        title=${`${r.label}: ${label}${r.detail ? ', ' + r.detail : ''}`}
        style=${onRowClick ? 'cursor:pointer' : ''}
        onClick=${onRowClick ? () => onRowClick(r) : undefined}
        onKeyDown=${onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(r); } : undefined}>
        <span class="lab">${r.color && html`<i style=${{ background: c }}></i>`}<span style="overflow:hidden;text-overflow:ellipsis">${r.label}</span></span>
        <span class="track"><span class="bar" style=${{ width: pct + '%', background: c }}></span></span>
        <span class="val num">${label}</span>
      </div>`;
    })}
  </div>`;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

// Columns over time. series: [{key, label, color}], points: [{key, label, values: {seriesKey: number}}]
export function ColumnChart({ points, series, height = 220, unit = 'h', title }) {
  const [tip, setTip] = useState(null);
  const [width, setWidth] = useState(760);
  const wrap = useRef();
  // Draw at the container's real width so axis text stays 12px on phones and in narrow panels.
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width); if (w > 0) setWidth(w); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = Math.max(280, width), H = height, padL = 40, padR = 8, padT = 12, padB = 28;
  const totals = points.map((p) => series.reduce((s, se) => s + (p.values[se.key] || 0), 0));
  const top = niceMax(Math.max(0, ...totals));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const band = plotW / Math.max(1, points.length);
  const barW = Math.min(24, Math.max(4, band * 0.62));
  const y = (v) => padT + plotH - (v / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 64))));

  const show = (i, evt) => {
    const box = wrap.current?.getBoundingClientRect();
    const svgX = padL + band * i + band / 2;
    const x = box ? (svgX / W) * box.width : 0;
    setTip({ i, x, y: box ? (y(totals[i]) / H) * box.height : 0 });
  };

  return html`<div class="chart-wrap" ref=${wrap} onMouseLeave=${() => setTip(null)}>
    <svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${title || 'Hours over time'}>
      ${ticks.map((t, k) => html`<g key=${'t' + k}>
        <line class="grid" x1=${padL} x2=${W - padR} y1=${y(t)} y2=${y(t)} />
        <text x=${padL - 6} y=${y(t) + 4} text-anchor="end">${fmtHours(t, t < 10 ? 1 : 0)}</text></g>`)}
      ${points.map((p, i) => {
        const cx = padL + band * i + band / 2;
        let acc = 0;
        const segs = series.map((se) => ({ se, v: p.values[se.key] || 0 })).filter((s) => s.v > 0);
        return html`<g class="col" key=${p.key} tabindex="0" role="img" aria-label=${`${p.label}: ${fmtHours(totals[i])} ${unit}`}
          onMouseMove=${(e) => show(i, e)} onFocus=${(e) => show(i, e)} onBlur=${() => setTip(null)}>
          <rect class="hitbox" x=${padL + band * i} y=${padT} width=${band} height=${plotH} fill="transparent" />
          ${segs.map((s, k) => {
            const y0 = y(acc), y1 = y(acc + s.v);
            acc += s.v;
            const isTop = k === segs.length - 1;
            const h = Math.max(0, y0 - y1 - (isTop ? 0 : 2));
            const top = y1 + (isTop ? 0 : 2);
            return isTop
              ? html`<path class="seg" key=${s.se.key} fill=${seriesColor(s.se.color)} d=${roundTop(cx - barW / 2, y1, barW, Math.max(0, y0 - y1), 4)} />`
              : html`<rect class="seg" key=${s.se.key} fill=${seriesColor(s.se.color)} x=${cx - barW / 2} y=${top} width=${barW} height=${h} />`;
          })}
          ${i % labelEvery === 0 && html`<text x=${cx} y=${H - 8} text-anchor="middle">${p.label}</text>`}
        </g>`;
      })}
      <line class="grid" x1=${padL} x2=${W - padR} y1=${y(0)} y2=${y(0)} style="stroke:var(--line-2)" />
    </svg>
    ${tip && html`<div class="chart-tip" style=${{ left: tip.x + 'px', top: tip.y + 'px' }}>
      <div class="t">${points[tip.i].long || points[tip.i].label}</div>
      ${series.length > 1 && series.filter((se) => points[tip.i].values[se.key]).map((se) => html`<div class="r" key=${se.key}><span class="row" style="gap:6px"><span class="key" style=${{ background: seriesColor(se.color) }}></span>${se.label}</span><b>${fmtHours(points[tip.i].values[se.key])} ${unit}</b></div>`)}
      <div class="r"><span>${series.length > 1 ? 'Total' : 'Hours'}</span><b>${fmtHours(totals[tip.i])} ${unit}</b></div>
    </div>`}
    ${series.length > 1 && html`<div class="legend" style="margin-top:8px">${series.map((se) => html`<span key=${se.key}><i style=${{ background: seriesColor(se.color) }}></i>${se.label}</span>`)}</div>`}
  </div>`;
}

// Column with a 4px rounded top and a square base.
function roundTop(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
