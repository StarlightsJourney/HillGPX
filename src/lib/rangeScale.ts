import { M_TO_FT, METRES_PER_MILE, type Units } from './units';

/**
 * The scale behind the range filters (distance, elevation gain, time): where
 * the handle can stop, the histogram drawn above it, and how a bound is
 * written in and read back from a field. Pure, so it can be tested without a
 * browser.
 */

/** Times go to the slider in five-minute units, so every stop is a time that prints exactly. */
export const DURATION_UNIT_MIN = 5;
export const DURATION_UNIT_S = DURATION_UNIT_MIN * 60;

export interface RangeScale {
  /** The top of the track: the 95th percentile, rounded up to a whole bar. */
  hi: number;
  /** Distance between stops, a round number in the unit the reader sees. */
  step: number;
  /** Every value a dragged handle can stop on, ascending, from 0 to `hi`. */
  stops: number[];
  /** Width of one histogram bar: a whole number of steps, so a bar's edges are stops. */
  bar: number;
  /** How many bars there are: `hi / bar`. */
  bars: number;
  /** Some values lie beyond `hi`, folded into the last bar. */
  truncated: boolean;
}

/** Fewest and most bars. Below six a histogram says little; above twenty the bars go thin and gappy. */
const MIN_BARS = 6;
const MAX_BARS = 20;

/**
 * A linear scale from 0, its stops on round numbers and its bars sized to the data.
 *
 * The top is the 95th percentile, not the maximum: one 1,900 km ride among
 * five-kilometre runs would otherwise stretch the track until every stop was a
 * hundred kilometres apart. The step is the first of `steps` that keeps the
 * stops to twenty, so a 70 km spread reads 5 km, 10 km … rather than 4.2 km,
 * 8.4 km …
 *
 * How many bars to draw depends on how many values there are (the Rice rule,
 * 2 × the cube root of the count): a few dozen routes in twenty thin bars is
 * mostly empty gaps, while a thousand venues can carry all twenty. Each bar
 * spans a whole number of steps, so every bar edge is a place a handle can stop.
 */
export function buildScale(values: readonly number[], steps: readonly number[]): RangeScale {
  let max = 0;
  for (const v of values) if (v > max) max = v;
  if (max <= 0) return { hi: steps[0], step: steps[0], stops: [0, steps[0]], bar: steps[0], bars: 1, truncated: false };
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const top = Math.min(max, p95);
  const step = steps.find((s) => Math.ceil(top / s) <= MAX_BARS) ?? Math.ceil(top / MAX_BARS);
  const intervals = Math.max(1, Math.ceil(top / step));
  const wanted = Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(2 * Math.cbrt(values.length))));
  const perBar = Math.max(1, Math.round(intervals / wanted));
  const bar = perBar * step;
  const bars = Math.max(1, Math.ceil(top / bar));
  const stopCount = bars * perBar;
  const stops = Array.from({ length: stopCount + 1 }, (_, i) => Number((i * step).toFixed(6)));
  return { hi: stops[stopCount], step, stops, bar, bars, truncated: max > stops[stopCount] };
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

/** How many values fall in each bar; anything past the top counts in the last. */
export function histogram(values: readonly number[], scale: RangeScale): number[] {
  const counts = new Array<number>(scale.bars).fill(0);
  for (const v of values) counts[Math.min(scale.bars - 1, Math.max(0, Math.floor(v / scale.bar)))] += 1;
  return counts;
}

/**
 * A bar's height from 0 to 1. Square-rooted: the busiest bar holds many times
 * the quietest, and the thin tail is the half of the range someone opening this
 * control is trying to see into. A bar with anything in it is never shorter than
 * a stub; an empty one is a still shorter, quiet baseline, so the row reads as
 * evenly spaced bars rather than as missing data.
 */
export function barHeight(count: number, tallest: number): number {
  if (count <= 0 || tallest <= 0) return EMPTY_BAR;
  return Math.min(1, Math.max(MIN_BAR, Math.sqrt(count / tallest)));
}
const EMPTY_BAR = 0.05;
const MIN_BAR = 0.14;

/** The share of a bar the matching values fill, 0 to 1 (linear: it is a share of that bar). */
export function matchShare(matching: number, count: number): number {
  if (matching <= 0 || count <= 0) return 0;
  return Math.min(1, Math.max(0.1, matching / count));
}

/* ─── What a bound looks like ─────────────────────────────────────────── */

/** How one kind of bound is shown, typed and kept. Values are in the slider's own unit. */
export interface RangeKind {
  /** Candidate step sizes for the scale, ascending: round numbers in the unit the reader sees. */
  steps: readonly number[];
  /** The keypad a phone shows for a field: numbers only, or text where a time is typed as "1h30". */
  inputMode: 'decimal' | 'text';
  /** A bound for a label: "12.5 km", "1 h 30 min". */
  label: (value: number) => string;
  /** What was typed, as a bound. Null when it is not a number this field understands. */
  fromField: (text: string) => number | null;
}

/** "12.5", "12", never "12.0". */
function trim(n: number, digits = 1): string {
  return String(Number(n.toFixed(digits)));
}

/**
 * A plain non-negative number, with a comma or a point for the decimal. A unit
 * may follow it, but only one of `units` (the field's own): "12 mi" in a km
 * field is not 12.
 */
function parseNumber(text: string, units: readonly string[] = []): number | null {
  const cleaned = text.trim().toLowerCase().replace(/\s+/g, '');
  const match = /^(\d+(?:[.,]\d+)?|[.,]\d+)([a-z]*)$/.exec(cleaned);
  if (!match || (match[2] && !units.includes(match[2]))) return null;
  const n = Number(match[1].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

const toMetres = { metric: 1000, imperial: METRES_PER_MILE } as const;

export function distanceKind(units: Units): RangeKind {
  const perUnit = toMetres[units];
  const unit = units === 'imperial' ? 'mi' : 'km';
  const stepsInUnit = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  return {
    steps: stepsInUnit.map((s) => s * perUnit),
    inputMode: 'decimal',
    label: (m) => `${trim(m / perUnit)} ${unit}`,
    // To the tenth of a km or mile, which is as precise as a route's length is.
    fromField: (text) => {
      const n = parseNumber(text, units === 'imperial' ? ['mi', 'miles'] : ['km', 'k']);
      return n == null ? null : Math.round(n * 10) / 10 * perUnit;
    },
  };
}

export function heightKind(units: Units): RangeKind {
  const perUnit = units === 'imperial' ? 1 / M_TO_FT : 1;
  const unit = units === 'imperial' ? 'ft' : 'm';
  const stepsInUnit = units === 'imperial' ? [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000] : [5, 10, 20, 25, 50, 100, 200, 500, 1000, 2000];
  return {
    steps: stepsInUnit.map((s) => s * perUnit),
    inputMode: 'decimal',
    label: (m) => `${Math.round(m / perUnit)} ${unit}`,
    // Whole metres or feet: the data has metres of error in it already.
    fromField: (text) => {
      const n = parseNumber(text, units === 'imperial' ? ['ft', 'feet'] : ['m']);
      return n == null ? null : Math.round(n) * perUnit;
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
 * "45 min". A bare number is minutes. Null when it is none of these.
 */
export function parseMinutes(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  const clock = /^(\d+):(\d{1,2})$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const parts = /^(?:(\d+(?:[.,]\d+)?)h(?:ours?|rs?)?)?(?:(\d+)(?:m(?:ins?|inutes?)?)?)?$/.exec(t);
  if (parts && (parts[1] || parts[2])) return Math.round(Number(parts[1]?.replace(',', '.') ?? 0) * 60 + Number(parts[2] ?? 0));
  return null;
}

/** Time: the slider's unit is five minutes, so what is typed is rounded to five. */
export const durationKind: RangeKind = {
  steps: [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map((minutes) => minutes / DURATION_UNIT_MIN),
  inputMode: 'text',
  label: (units) => minutesLabel(units * DURATION_UNIT_MIN),
  fromField: (text) => {
    const minutes = parseMinutes(text);
    return minutes == null ? null : Math.round(minutes / DURATION_UNIT_MIN);
  },
};
