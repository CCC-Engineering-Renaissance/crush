// Date and duration helpers. Everything displays in the device's local time zone.

export function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

export function entryMs(e, now = Date.now()) {
  const s = toDate(e.start); if (!s) return 0;
  const end = toDate(e.end) || (e.status === 'open' ? new Date(now) : null);
  return end ? Math.max(0, end - s) : 0;
}

export function hours(ms) { return ms / HOUR; }

export function fmtHours(h, digits = 1) {
  if (!isFinite(h)) return '0';
  const r = Math.round(h * 10 ** digits) / 10 ** digits;
  return r.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60), mm = m % 60;
  if (h === 0) return `${mm} min`;
  return mm ? `${h} h ${String(mm).padStart(2, '0')} min` : `${h} h`;
}

export function clockParts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return { h, m, s: sec, text: `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` };
}

const tf = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const df = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dfy = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const mdf = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const monthf = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const monShort = new Intl.DateTimeFormat(undefined, { month: 'short' });

export const fmtTime = (d) => (d ? tf.format(toDate(d)) : '');
export const fmtDate = (d) => {
  d = toDate(d); if (!d) return '';
  return (d.getFullYear() === new Date().getFullYear() ? df : dfy).format(d);
};
export const fmtShortDate = (d) => (d ? mdf.format(toDate(d)) : '');
export const fmtMonth = (d) => monthf.format(toDate(d));
export const fmtMonShort = (d) => monShort.format(toDate(d));
export const fmtDateTime = (d) => (d ? `${fmtDate(d)} at ${fmtTime(d)}` : '');

export function fmtRange(a, b) {
  a = toDate(a); b = toDate(b);
  if (!a) return '';
  if (!b) return `${fmtTime(a)} – now`;
  if (sameDay(a, b)) return `${fmtTime(a)} – ${fmtTime(b)}`;
  return `${fmtTime(a)} – ${fmtShortDate(b)}, ${fmtTime(b)}`;
}

export function relTime(d) {
  d = toDate(d); if (!d) return '';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  if (abs < 60e3) return 'just now';
  if (abs < HOUR) { const m = Math.round(abs / 60e3); return diff > 0 ? `${m} min ago` : `in ${m} min`; }
  if (abs < DAY && sameDay(d, new Date())) { const h = Math.round(abs / HOUR); return diff > 0 ? `${h} h ago` : `in ${h} h`; }
  if (sameDay(d, addDays(new Date(), -1))) return 'yesterday';
  if (sameDay(d, addDays(new Date(), 1))) return 'tomorrow';
  return fmtShortDate(d);
}

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function startOfDay(d) { d = new Date(toDate(d)); d.setHours(0, 0, 0, 0); return d; }
export function addDays(d, n) { d = new Date(toDate(d)); d.setDate(d.getDate() + n); return d; }
export function sameDay(a, b) { a = toDate(a); b = toDate(b); return a && b && a.toDateString() === b.toDateString(); }
export function startOfWeek(d) { d = startOfDay(d); const dow = (d.getDay() + 6) % 7; return addDays(d, -dow); } // Monday
export function startOfMonth(d) { d = startOfDay(d); d.setDate(1); return d; }
export function addMonths(d, n) { d = new Date(toDate(d)); const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); d.setDate(Math.min(day, daysInMonth(d))); return d; }
export function daysInMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }

export function isoDate(d) {
  d = toDate(d); if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function parseIsoDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function toLocalInput(d) {
  d = toDate(d); if (!d) return '';
  return `${isoDate(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fromLocalInput(s) { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d; }
export function timeInput(d) { d = toDate(d); return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''; }
export function combine(dateStr, timeStr) {
  const d = parseIsoDate(dateStr); if (!d) return null;
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

export function termRange(settings) {
  const from = parseIsoDate(settings?.termStart);
  const end = parseIsoDate(settings?.termEnd);
  if (from && end && end > from) return { from, to: addDays(end, 1) };
  return { from: addDays(startOfDay(new Date()), -120), to: addDays(startOfDay(new Date()), 1) };
}

export const RANGE_PRESETS = [
  ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'],
  ['term', 'This term'], ['30', 'Last 30 days'], ['custom', 'Custom dates'],
];

export function presetRange(key, settings) {
  const today = startOfDay(new Date());
  switch (key) {
    case 'week': return { from: startOfWeek(today), to: addDays(startOfWeek(today), 7) };
    case 'lastweek': return { from: addDays(startOfWeek(today), -7), to: startOfWeek(today) };
    case 'month': return { from: startOfMonth(today), to: addMonths(startOfMonth(today), 1) };
    case 'lastmonth': return { from: addMonths(startOfMonth(today), -1), to: startOfMonth(today) };
    case '30': return { from: addDays(today, -29), to: addDays(today, 1) };
    case 'term':
    default: return termRange(settings);
  }
}

export function weekKey(d) { return isoDate(startOfWeek(d)); }
