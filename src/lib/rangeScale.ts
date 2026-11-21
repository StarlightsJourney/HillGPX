import { M_TO_FT, METRES_PER_MILE, formatDistanceIn, formatHeight, type Units } from './units';
import { formatEstimate } from './routeTime';

/**
 * The scale behind the range filters (distance, elevation gain, time): where
 * the handle can stop, the histogram drawn above it, and how a bound is
 * written in and read back from a field. Pure, so it can be tested without a
 * browser.
 */

/** Times go to the slider in five-minute units, so every stop it can land on is a time the label can print exactly. */
export const DURATION_UNIT_MIN = 5;
export const DURATION_UNIT_S = DURATION_UNIT_MIN * 60;

/** Bars in the histogram. Twenty is the most this data supports without gaps:
 *  HDB heights are storeys × 2.8 m, so buckets narrower than that at the low
 *  end fall between two rungs of the ladder the data is actually on and come
 *  out empty, which reads as missing data rather than as a bucketing artefact. */
export const BUCKETS = 20;

export interface RangeScale {
  lo: number;
  hi: number;
  /** Bucket width in the pool's own units. */
  step: number;
  /** Every value a handle can stop on, ascending. */
  stops: number[];
  /** Some pool values lie beyond `hi`, folded into the last bucket. */
  truncated: boolean;
}

/**
 * Linear scale starting from 0 so the histogram reads intuitively.
 *
 * The top is the 95th percentile, not the maximum: one 1,900 km ride or
 * 26,000 m Everesting among five-kilometre runs would otherwise stretch the
 * track so far that every handle stop landed a hundred kilometres apart and
 * no real bound could be picked. The tail folds into the last bucket and is
 * still reachable: the top stop means "no bound", and a min handle there
 * keeps everything at and above `hi`.
 */
export function buildScale(values: readonly number[]): RangeScale {
  let max = 0;
  for (const h of values) {
    if (h > max) max = h;
  }
  if (max <= 1) return { lo: 0, hi: 1, step: 1, stops: [0, 1], truncated: false };
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const hi = Math.ceil(Math.max(1, Math.min(max, p95)));
  const step = Math.max(1, Math.ceil(hi / BUCKETS));

  const stops: number[] = [0];
  for (let v = step; v <= hi; v += step) stops.push(v);
  if (stops[stops.length - 1] < hi) stops.push(hi);

  return { lo: 0, hi, step, stops, truncated: max > hi };
}

/** Where a value sits along the track, 0 to 1 (past the top reads as the end). */
export function positionOf(value: number, scale: RangeScale): number {
  return Math.min(scale.hi, Math.max(0, value)) / scale.hi;
}

/** The stop nearest a point on the track (0 to 1). */
export function stopAt(ratio: number, scale: RangeScale): number {
  const target = Math.min(1, Math.max(0, ratio)) * scale.hi;
  let best = 0;
  let bestGap = Infinity;
  for (let i = 0; i < scale.stops.length; i += 1) {
    const gap = Math.abs(scale.stops[i] - target);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

/** The next stop above (`direction` 1) or below (-1) a value, or null at the end. */
export function neighbourStop(value: number, direction: 1 | -1, scale: RangeScale): number | null {
  const eps = scale.step * 1e-6;
  if (direction === 1) return scale.stops.find((s) => s > value + eps) ?? null;
  for (let i = scale.stops.length - 1; i >= 0; i -= 1) if (scale.stops[i] < value - eps) return scale.stops[i];
  return null;
}

/** How many values fall in each of the twenty buckets; anything past the top counts in the last. */
export function histogram(values: readonly number[], scale: RangeScale): number[] {
  const counts = new Array<number>(BUCKETS).fill(0);
  for (const h of values) counts[Math.min(BUCKETS - 1, Math.max(0, Math.floor(h / scale.step)))] += 1;
  return counts;
}

/* ─── What a bound looks like ─────────────────────────────────────────── */

/** How one kind of bound is shown, typed and kept. Values are in the slider's own unit. */
export interface RangeKind {
  /** The keypad a phone shows for a field: numbers only, or text where a time is typed as "1h30". */
  inputMode: 'decimal' | 'text';
  /** A bound as the filters print it: "12.4 km", "535 ft", "~1 h 30 min". */
  label: (value: number) => string;
  /** What was typed, as a bound. Null when it is not a number this field understands. */
  fromField: (text: string) => number | null;
}

/**
 * A plain non-negative number with a comma or a point for the decimal, and the
 * unit that followed it (empty when none). Null when it is not a number.
 */
function parseQuantity(text: string): { n: number; unit: string } | null {
  const cleaned = text.trim().toLowerCase().replace(/\s+/g, '');
  const match = /^(\d+(?:[.,]\d+)?|[.,]\d+)([a-z]*)$/.exec(cleaned);
  if (!match) return null;
  const n = Number(match[1].replace(',', '.'));
  return Number.isFinite(n) ? { n, unit: match[2] } : null;
}

/**
 * A distance in metres. A bare number is kilometres (or miles); a unit may
 * follow, in the system the reader is using: "12.5", "12 km", "800 m", "3 mi", "500 ft".
 */
export function distanceKind(units: Units): RangeKind {
  return {
    inputMode: 'decimal',
    label: (m) => formatDistanceIn(m, units),
    fromField: (text) => {
      const q = parseQuantity(text);
      if (!q) return null;
      if (units === 'imperial') {
        if (q.unit === 'ft' || q.unit === 'feet') return Math.round(q.n) / M_TO_FT;
        if (q.unit === '' || q.unit === 'mi' || q.unit === 'miles') return (Math.round(q.n * 10) / 10) * METRES_PER_MILE;
        return null;
      }
      if (q.unit === 'm') return Math.round(q.n);
      if (q.unit === '' || q.unit === 'km' || q.unit === 'k') return (Math.round(q.n * 10) / 10) * 1000;
      return null;
    },
  };
}

/** A height in metres, typed in whole metres or feet. */
export function heightKind(units: Units): RangeKind {
  const perUnit = units === 'imperial' ? 1 / M_TO_FT : 1;
  const own = units === 'imperial' ? ['ft', 'feet'] : ['m'];
  return {
    inputMode: 'decimal',
    label: (m) => formatHeight(m, units),
    // Whole metres or feet: the data has metres of error in it already.
    fromField: (text) => {
      const q = parseQuantity(text);
      return q && (q.unit === '' || own.includes(q.unit)) ? Math.round(q.n) * perUnit : null;
    },
  };
}

/** "45 min", "1 h", "1 h 30 min". */
export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Minutes from what someone types: "90", "1:30", "1h30", "1h 30m", "1.5h",
 * "45 min", "~1 h 30 min". A bare number is minutes. Null when it is none of these.
 */
export function parseMinutes(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/^~/, '').replace(/\s+/g, '');
  if (!t) return null;
  const clock = /^(\d+):(\d{1,2})$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const parts = /^(?:(\d+(?:[.,]\d+)?)h(?:ours?|rs?)?)?(?:(\d+)(?:m(?:ins?|inutes?)?)?)?$/.exec(t);
  if (parts && (parts[1] || parts[2])) return Math.round(Number(parts[1]?.replace(',', '.') ?? 0) * 60 + Number(parts[2] ?? 0));
  return null;
}

/** Time: the slider's unit is five minutes, so what is typed is rounded to five. */
export const durationKind: RangeKind = {
  inputMode: 'text',
  label: (units) => (units === 0 ? '0 min' : formatEstimate(units * DURATION_UNIT_S)),
  fromField: (text) => {
    const minutes = parseMinutes(text);
    return minutes == null ? null : Math.round(minutes / DURATION_UNIT_MIN);
  },
};
