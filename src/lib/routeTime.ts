import type { RouteActivity } from '../types';
import { CLIMB_S_PER_10M, DEFAULT_PACE_S_PER_KM } from './routeMatch';

/**
 * Rough time for a route at an easy, average pace: flat-ground pace per
 * kilometre plus an allowance for each 10 m climbed. A guide for planning,
 * not a promise: fitness, surface and weather move it a lot.
 */
interface Effort {
  /** Seconds per kilometre on flat ground. */
  paceSPerKm: number;
  /** Seconds added for every 10 m climbed. */
  climbSPer10M: number;
}

export const EFFORT: Record<RouteActivity, Effort> = {
  // Easy run: the same pace and climb allowance the run planner uses.
  run: { paceSPerKm: DEFAULT_PACE_S_PER_KM, climbSPer10M: CLIMB_S_PER_10M },
  // Trail: a mix of jogging and hiking, 9:00/km, with a heavier climb allowance.
  trail: { paceSPerKm: 540, climbSPer10M: 45 },
  // Ride: about 18 km/h on the flat, climbing costs less per metre than on foot.
  cycle: { paceSPerKm: 200, climbSPer10M: 8 },
};

/** Estimated moving time in seconds. A route with no activity reads as a run, like the planner. */
export function estimateRouteTimeS(distanceM: number, gainM: number, activity: RouteActivity | undefined): number {
  const effort = EFFORT[activity ?? 'run'];
  return (distanceM / 1000) * effort.paceSPerKm + (Math.max(0, gainM) / 10) * effort.climbSPer10M;
}

/** "~45 min", "~1 h 45 min", "~3 h": rounded, because the estimate is not precise. */
export function formatEstimate(seconds: number): string {
  const rounded = Math.max(5, Math.round(seconds / 60 / 5) * 5);
  if (rounded < 60) return `~${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `~${hours} h` : `~${hours} h ${rest} min`;
}

/** What the estimate assumes, shown as the tooltip on the panel's "Est. time". */
export const ESTIMATE_NOTE: Record<RouteActivity, string> = {
  run: 'Estimated at an easy running pace (6:30 per km) plus time for climbing. Yours will differ.',
  trail: 'Estimated at an easy trail jog and hike mix (9:00 per km) plus time for climbing. Yours will differ.',
  cycle: 'Estimated at a relaxed riding pace (about 18 km/h) plus time for climbing. Yours will differ.',
};
