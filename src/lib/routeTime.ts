import type { Route, RouteActivity, RoutePoint } from '../types';
import { haversineM } from './elevation';
import { routeActivity } from './routeAnalysis';

/**
 * Route duration: one global, average-effort forecast from distance, climbing
 * and endurance fatigue. A guide for planning, not a promise: fitness, surface
 * and weather move it a lot.
 *
 * 1. The track is resampled into buckets of at least `BUCKET_M`, so GPS jitter
 *    between neighbouring points cannot add climbing.
 * 2. Bucket elevations are smoothed (3-point moving average) and a deadband
 *    ignores changes under `DEADBAND_M`. Grades are clamped to ±`MAX_GRADE`.
 * 3. Each climbing bucket is gentle (up to `STEEP_GRADE`) or steep. The
 *    effective distance is D + gentle/100 + 1.4 × steep/100 (km, metres).
 * 4. hours = (Deq / S) × max(1, Deq / 10)^0.09, where S is the activity's base
 *    speed; the power law is the fatigue that grows with distance.
 * 5. The result is rounded to a clean number: 5 min under 2 h, 10 min up to
 *    6 h, 15 min beyond.
 */

/** Base speed on flat ground, km/h. A trail is about 17% slower than the road: rougher ground, more scrambling. */
export const BASE_SPEED_KMH: Record<RouteActivity, number> = { run: 9, trail: 7.5, cycle: 22.5 };

/** The run planner's default pace, s per km: the running base speed (9 km/h). */
export const DEFAULT_PACE_S_PER_KM = 3600 / BASE_SPEED_KMH.run;

const BUCKET_M = 75;
const DEADBAND_M = 3;
const MAX_GRADE = 0.35;
const STEEP_GRADE = 0.1;
const STEEP_WEIGHT = 1.4;
const FATIGUE_FROM_KM = 10;
const FATIGUE_EXPONENT = 0.09;

/** What the estimate rests on, shown with it. */
export const ESTIMATE_CAPTION = 'Realistic average time based on distance, climbing, and endurance fatigue.';

/** A route reduced to what the duration needs: flat distance, and climbing split by steepness. */
export interface ClimbProfile {
  distanceKm: number;
  /** Metres climbed at grades up to 10%. */
  gentleM: number;
  /** Metres climbed at grades above 10%. */
  steepM: number;
}

export interface RouteDurationEstimate {
  minutes: number;
  /** "15h 30m". */
  formatted: string;
  /** Distance with climbing folded in, in km. */
  effectiveDistanceKm: number;
  caption: string;
}

function elevationOf(point: RoutePoint): number {
  return Number.isFinite(point[2]) ? point[2] : 0;
}

/**
 * Distance and climbing of a track. Points that did not move are dropped, and a
 * track without elevation (all zeros) simply has none, so its time is by
 * distance and fatigue alone. Pass `elevationKnown: false` to ignore the
 * elevations given.
 */
export function climbProfile(points: readonly RoutePoint[], elevationKnown = true): ClimbProfile {
  const lengths: number[] = [];
  const ends: number[] = [];
  if (points.length >= 2) {
    const eleOf = (point: RoutePoint) => (elevationKnown ? elevationOf(point) : 0);
    let from = points[0];
    let span = 0;
    for (let i = 1; i < points.length; i++) {
      const point = points[i];
      const d = haversineM(from[0], from[1], point[0], point[1]);
      if (!(d > 0)) continue; // a pause, or a bad coordinate
      span += d;
      from = point;
      if (span >= BUCKET_M) {
        lengths.push(span);
        ends.push(eleOf(point));
        span = 0;
      }
    }
    if (span > 0) {
      // A short remainder joins the last bucket, so it cannot read as a cliff.
      if (lengths.length) {
        lengths[lengths.length - 1] += span;
        ends[ends.length - 1] = eleOf(from);
      } else {
        lengths.push(span);
        ends.push(eleOf(from));
      }
    }
    ends.unshift(eleOf(points[0]));
  }

  const distanceKm = lengths.reduce((sum, length) => sum + length, 0) / 1000;
  if (lengths.length === 0) return { distanceKm, gentleM: 0, steepM: 0 };

  // 3-point moving average over the bucket boundaries; the two ends are kept as measured.
  const last = ends.length - 1;
  const smooth = ends.map((elevation, i) => (i === 0 || i === last ? elevation : (ends[i - 1] + elevation + ends[i + 1]) / 3));

  // Deadband: the level only moves once the track has moved 3 m from it.
  let level = smooth[0];
  let gentleM = 0;
  let steepM = 0;
  for (let i = 1; i < smooth.length; i++) {
    let next = level;
    if (Math.abs(smooth[i] - level) >= DEADBAND_M) next = smooth[i];
    const lengthM = lengths[i - 1];
    const delta = Math.max(-MAX_GRADE * lengthM, Math.min(MAX_GRADE * lengthM, next - level));
    level = next;
    if (delta <= 0) continue;
    if (delta / lengthM <= STEEP_GRADE) gentleM += delta;
    else steepM += delta;
  }
  return { distanceKm, gentleM, steepM };
}

/** Round minutes to a clean number: 5 under 2 h, 10 up to 6 h, 15 beyond. */
export function roundDurationMinutes(minutes: number): number {
  const step = minutes < 120 ? 5 : minutes <= 360 ? 10 : 15;
  return Math.max(step, Math.round(minutes / step) * step);
}

/** "45m", "1h 10m", "15h 30m". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * Estimated moving time of a profile. A route with no activity reads as a run.
 * `paceScale` stretches the whole time for a runner slower or quicker than the
 * default (1 is the base speed).
 */
export function estimateProfile(profile: ClimbProfile, activity: RouteActivity | undefined, paceScale = 1): RouteDurationEstimate {
  const effectiveKm = profile.distanceKm + profile.gentleM / 100 + (STEEP_WEIGHT * profile.steepM) / 100;
  const fatigue = Math.max(1, effectiveKm / FATIGUE_FROM_KM) ** FATIGUE_EXPONENT;
  const hours = (effectiveKm / BASE_SPEED_KMH[activity ?? 'run']) * fatigue * paceScale;
  const minutes = roundDurationMinutes(hours * 60);
  return {
    minutes,
    formatted: formatDuration(minutes),
    effectiveDistanceKm: Math.round(effectiveKm * 10) / 10,
    caption: ESTIMATE_CAPTION,
  };
}

/** The estimate for a track, by its activity. */
export function estimateTrackDuration(points: readonly RoutePoint[], activity: RouteActivity | undefined, paceScale = 1, elevationKnown = true): RouteDurationEstimate {
  return estimateProfile(climbProfile(points, elevationKnown), activity, paceScale);
}

/**
 * Estimated moving time in seconds from a distance and total climb alone, for
 * when there is no track to read the steepness from: the climb counts as
 * gentle. A route with no activity reads as a run.
 */
export function estimateRouteTimeS(distanceM: number, gainM: number, activity: RouteActivity | undefined, paceScale = 1): number {
  const profile = { distanceKm: distanceM / 1000, gentleM: Math.max(0, gainM), steepM: 0 };
  return estimateProfile(profile, activity, paceScale).minutes * 60;
}

const profiles = new WeakMap<readonly RoutePoint[], ClimbProfile>();

/** A route's profile, worked out once per set of coordinates (lists ask for every route on every render). */
function profileOf(route: Route): ClimbProfile {
  const known = route.elevationAvailable !== false;
  const cached = known ? profiles.get(route.coordinates) : undefined;
  if (cached) return cached;
  const profile = climbProfile(route.coordinates, known);
  if (known) profiles.set(route.coordinates, profile);
  return profile;
}

/**
 * A route's estimated time by its own activity, with its climb counted only
 * when its elevation is known. What the planner, filter, cards and panel use.
 */
export function routeEstimateS(route: Route, paceScale = 1): number {
  // A route without usable coordinates falls back to its stored distance and gain.
  if (route.coordinates.length < 2) {
    return estimateRouteTimeS(route.distanceM, route.elevationAvailable === false ? 0 : route.gainM, routeActivity(route), paceScale);
  }
  return estimateProfile(profileOf(route), routeActivity(route), paceScale).minutes * 60;
}

/** "~45 min", "~1 h 45 min", "~3 h": rounded, because the estimate is not precise. */
export function formatEstimate(seconds: number): string {
  const rounded = Math.max(5, Math.round(seconds / 60 / 5) * 5);
  if (rounded < 60) return `~${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `~${hours} h` : `~${hours} h ${rest} min`;
}
