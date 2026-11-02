import type { RouteActivity, RoutePoint } from '../types';
import { haversineM } from './elevation';

/**
 * Automated validity checks for an uploaded track. A route that trips a `key`
 * flag is held: stored, but visible only to the account that uploaded it. An
 * `advisory` flag never blocks publication; it is a note for the uploader.
 *
 * Pure and dependency-free so it can be tested against real GPX files and
 * reused by import scripts. Run it on the raw parsed track, before
 * simplification: Douglas–Peucker merges straight stretches into long
 * segments that would otherwise look like GPS jumps.
 */

export type QualityFlagId = 'gps-jump' | 'impossible-speed' | 'too-short' | 'implausible-elevation' | 'no-elevation';

export interface QualityFlag {
  id: QualityFlagId;
  severity: 'key' | 'advisory';
  /** What was measured, in the unit named by `unit`. */
  value: number;
  /** The limit it was compared with. */
  threshold: number;
  unit: 'km/h' | 'm' | 'points' | 'm/s' | 'm/km';
  /** How far along the track it happened, 0–1 of its length. Absent for whole-track flags. */
  at?: number;
}

export interface QualityAssessment {
  verdict: 'ok' | 'held';
  flags: QualityFlag[];
}

export interface QualityInput {
  /** The track as parsed from the file (or the stored points when editing). */
  points: RoutePoint[];
  /** Epoch ms per point, aligned with `points`; null where the file has no time. */
  times?: (number | null)[];
  activity: RouteActivity;
  /**
   * Whether the heights are real (the file's own, or filled from terrain). Pass
   * false when neither gave the track any elevation.
   */
  hasElevation: boolean;
  /**
   * Whether the heights came from the file itself (a device altimeter). Terrain
   * heights are plausible by construction, so the altimeter checks skip them.
   */
  deviceElevation: boolean;
  /**
   * `simplified` when the points are already thinned (a stored route being
   * re-trimmed): long gaps are normal there, so the no-timestamp gap check is
   * skipped. Defaults to `raw`.
   */
  spacing?: 'raw' | 'simplified';
}

/** Tunable limits; the issue's first-guess values. */
export const QUALITY_LIMITS = {
  /** A step implying more than this is not a person or a bike. */
  jumpKmh: 150,
  /** With no timestamps, adjacent raw points further apart than this are a jump. */
  jumpGapM: 2000,
  /** After a lone spike the track returns to within this of where it was. */
  spikeReturnM: 100,
  speedWindowS: 60,
  maxKmh: 80,
  maxFootKmh: 45,
  minDistanceM: 300,
  minPoints: 10,
  maxVerticalMps: 5,
  // Temporarily disabled: Infinity never trips. Restore to 400 to re-enable.
  maxGainPerKm: Infinity,
  gainWindowM: 1000,
} as const;

/** Flag ids that hold a route. Move one to `ADVISORY` to stop it blocking. */
const KEY: ReadonlySet<QualityFlagId> = new Set(['gps-jump', 'impossible-speed', 'too-short', 'implausible-elevation']);

function flag(id: QualityFlagId, value: number, threshold: number, unit: QualityFlag['unit'], at?: number): QualityFlag {
  return { id, severity: KEY.has(id) ? 'key' : 'advisory', value, threshold, unit, ...(at == null ? {} : { at }) };
}

export function assessRoute(input: QualityInput): QualityAssessment {
  const { points, times = [], activity, hasElevation, deviceElevation, spacing = 'raw' } = input;
  const flags: QualityFlag[] = [];

  const steps = points.slice(1).map((p, i) => haversineM(points[i][0], points[i][1], p[0], p[1]));
  const totalM = steps.reduce((sum, d) => sum + d, 0);
  /** Fraction of the track before point `index`, leaving out `skipStep` (a jump would otherwise dominate the total). */
  const along = (index: number, skipStep = -1) => {
    const total = totalM - (skipStep >= 0 ? steps[skipStep] : 0);
    return total > 0 ? steps.slice(0, index).reduce((sum, d, k) => sum + (k === skipStep ? 0 : d), 0) / total : 0;
  };

  if (totalM < QUALITY_LIMITS.minDistanceM || points.length < QUALITY_LIMITS.minPoints) {
    // Report whichever limit it is furthest under, so the wording names the real problem.
    if (points.length < QUALITY_LIMITS.minPoints) {
      flags.push(flag('too-short', points.length, QUALITY_LIMITS.minPoints, 'points'));
    } else {
      flags.push(flag('too-short', Math.round(totalM), QUALITY_LIMITS.minDistanceM, 'm'));
    }
  }

  const timed = (i: number): number | null => {
    const a = times[i];
    const b = times[i + 1];
    return a != null && b != null && b > a ? (b - a) / 1000 : null;
  };

  // GPS jumps: a step no person or bike could make, after which the track stays displaced.
  for (let i = 0; i < steps.length; i++) {
    const seconds = timed(i);
    const kmh = seconds != null ? (steps[i] / 1000) / (seconds / 3600) : null;
    // Short hops between two fixes have noisy speeds; a jump has to move a real distance too.
    const byTime = kmh != null && kmh > QUALITY_LIMITS.jumpKmh && steps[i] > 200;
    const byGap = seconds == null && spacing === 'raw' && steps[i] > QUALITY_LIMITS.jumpGapM;
    if (!byTime && !byGap) continue;
    // A lone out-and-back spike is one bad fix: the step out lands back where we were, and so does the step back.
    const near = (a: RoutePoint | undefined, b: RoutePoint | undefined) =>
      a != null && b != null && haversineM(a[0], a[1], b[0], b[1]) < QUALITY_LIMITS.spikeReturnM;
    if (near(points[i], points[i + 2]) || near(points[i - 1], points[i + 1])) continue;
    flags.push(flag('gps-jump', byTime ? Math.round(kmh as number) : Math.round(steps[i]), byTime ? QUALITY_LIMITS.jumpKmh : QUALITY_LIMITS.jumpGapM, byTime ? 'km/h' : 'm', along(i + 1, i)));
    break;
  }

  // Sustained speed: over the shortest run of steps spanning a full window, so one noisy fix does not trip it.
  const limit = activity === 'cycle' ? QUALITY_LIMITS.maxKmh : QUALITY_LIMITS.maxFootKmh;
  let worst = 0;
  let worstAt = 0;
  let lo = 0;
  let metres = 0;
  let seconds = 0;
  for (let hi = 0; hi < steps.length; hi++) {
    const s = timed(hi);
    // A teleporting step belongs to the jump check; letting it into a window would also hold a lone spike.
    if (s == null || (steps[hi] > 200 && (steps[hi] / 1000) / (s / 3600) > QUALITY_LIMITS.jumpKmh)) {
      lo = hi + 1;
      metres = 0;
      seconds = 0;
      continue;
    }
    metres += steps[hi];
    seconds += s;
    while (lo < hi && seconds - (timed(lo) as number) >= QUALITY_LIMITS.speedWindowS) {
      seconds -= timed(lo) as number;
      metres -= steps[lo];
      lo += 1;
    }
    if (seconds >= QUALITY_LIMITS.speedWindowS) {
      const kmh = (metres / 1000) / (seconds / 3600);
      if (kmh > worst) {
        worst = kmh;
        worstAt = lo;
      }
    }
  }
  if (worst > limit) flags.push(flag('impossible-speed', Math.round(worst), limit, 'km/h', along(worstAt)));

  if (!hasElevation) {
    flags.push(flag('no-elevation', 0, 1, 'm'));
  } else if (deviceElevation) {
    // Altimeter checks: a vertical step no one climbs, or climbing at a rate that is noise.
    let stuck = false;
    for (let i = 0; i < steps.length && !stuck; i++) {
      const seconds = timed(i);
      if (seconds == null) continue;
      const mps = Math.abs(points[i + 1][2] - points[i][2]) / seconds;
      if (mps > QUALITY_LIMITS.maxVerticalMps && seconds >= 1) {
        flags.push(flag('implausible-elevation', Number(mps.toFixed(1)), QUALITY_LIMITS.maxVerticalMps, 'm/s', along(i + 1)));
        stuck = true;
      }
    }
    if (!stuck) {
      let start = 0;
      let climbed = 0;
      let run = 0;
      for (let i = 0; i < steps.length; i++) {
        run += steps[i];
        climbed += Math.max(0, points[i + 1][2] - points[i][2]);
        if (run >= QUALITY_LIMITS.gainWindowM) {
          const perKm = climbed / (run / 1000);
          if (perKm > QUALITY_LIMITS.maxGainPerKm) {
            flags.push(flag('implausible-elevation', Math.round(perKm), QUALITY_LIMITS.maxGainPerKm, 'm/km', along(start)));
            break;
          }
          // Slide the window by one step rather than jumping a whole kilometre.
          run -= steps[start];
          climbed -= Math.max(0, points[start + 1][2] - points[start][2]);
          start += 1;
        }
      }
    }
  }

  return { verdict: flags.some((f) => f.severity === 'key') ? 'held' : 'ok', flags };
}

/** What the uploader sees for each flag: what is wrong and what to do about it. */
export function describeFlag(f: QualityFlag): string {
  const where = f.at != null ? ` about ${Math.round(f.at * 100)}% of the way along` : '';
  switch (f.id) {
    case 'gps-jump':
      return f.unit === 'km/h'
        ? `The track jumps${where}, as if moving at ${f.value} km/h. Trim around it or fix the recording.`
        : `The track jumps ${(f.value / 1000).toFixed(1)} km between two points${where}. Trim around it or fix the recording.`;
    case 'impossible-speed':
      return `The speed is ${f.value} km/h${where}, faster than ${f.threshold} km/h. Check the activity type and the timestamps.`;
    case 'too-short':
      return f.unit === 'points'
        ? `The track has only ${f.value} points; a route needs at least ${f.threshold}.`
        : `The track is only ${f.value} m long; a route needs at least ${f.threshold} m.`;
    case 'implausible-elevation':
      return f.unit === 'm/s'
        ? `The altitude changes ${f.value} m every second${where}, which looks like a faulty altimeter.`
        : `The track climbs ${f.value} m per km${where}, which looks like noisy altitude data.`;
    case 'no-elevation':
      return 'This track has no elevation data, so its climb is unknown. It will still be published.';
  }
}

export function keyFlags(assessment: QualityAssessment): QualityFlag[] {
  return assessment.flags.filter((f) => f.severity === 'key');
}
