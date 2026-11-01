import type { Route } from '../types';
import type { Bounds } from './venues';
import { NEAR_ME_RADII_M, distanceToRouteM, routeIntersects } from './routes';

export type Terrain = 'flat' | 'rolling' | 'hilly' | 'any';
export type RunLength = { kind: 'time'; minutes: number } | { kind: 'distance'; metres: number };
export type RunWhere = { kind: 'point'; lng: number; lat: number } | { kind: 'area'; bounds: Bounds };

export interface RunNeeds {
  where: RunWhere | null;
  length: RunLength | null;
  terrain: Terrain;
  paceSPerKm: number;
}

/** The runner's terrain when nothing has been chosen: every route fits. */
export const DEFAULT_TERRAIN: Terrain = 'any';

/** 6:30 per km on flat ground. */
export const DEFAULT_PACE_S_PER_KM = 390;

/**
 * Time added for climbing, in the spirit of Naismith's rule (a minute per
 * 10 m for walkers), halved for runners.
 */
export const CLIMB_S_PER_10M = 30;

/** How much each fit counts towards the score; only the needs that are set take part. */
export const WEIGHTS = { closeness: 0.3, length: 0.45, terrain: 0.25 } as const;

/** The distance at which closeness counts half. */
const CLOSENESS_HALF_M = 5_000;

export type TerrainBand = Exclude<Terrain, 'any'>;

/** Climb rate (m/km) bands: Flat below the first, Hilly above the second. */
export const TERRAIN_BANDS = { flatBelow: 10, hillyAbove: 30 } as const;
/** How far (m/km) outside the asked band a route's terrain fit falls to 0. */
const TERRAIN_SLACK = 30;
/** What a route of unknown terrain scores on terrain: neither fits nor misfits. */
const NEUTRAL = 0.5;

/** One structured piece of "why this route": the UI formats it in the visitor's units. */
export type MatchReason =
  | { kind: 'away'; metres: number }
  | { kind: 'length'; metres: number; durationS: number }
  | { kind: 'terrain'; band: TerrainBand | null; climbRateMPerKm: number | null };

/** What is off about a route, so a weak match can say why ("4 km longer than you asked"). */
export type MatchMiss =
  | { kind: 'length'; unit: 'distance' | 'time'; /** metres or seconds */ by: number; longer: boolean }
  | { kind: 'terrain'; wanted: TerrainBand; band: TerrainBand };

export type MatchLabel = 'great' | 'good' | 'partial';

/** Score thresholds for the labels. */
export const LABEL_AT = { great: 0.8, good: 0.6 } as const;
/** A route this much (as a share of the target) longer or shorter counts as off. */
const LENGTH_TOLERANCE = 0.2;

export interface RouteMatch {
  route: Route;
  /** 0–1, higher is better. */
  score: number;
  label: MatchLabel;
  misses: MatchMiss[];
  /** Estimated running time: pace on the flat plus the climbing allowance. */
  durationS: number;
  /** Closest approach to the runner (0 inside the area), or null with no "where". */
  awayM: number | null;
  reasons: MatchReason[];
}

function climbRateOf(route: Route): number | null {
  if (route.elevationAvailable === false || route.distanceM <= 0) return null;
  return route.gainM / (route.distanceM / 1000);
}

export function terrainBand(rateMPerKm: number): TerrainBand {
  if (rateMPerKm < TERRAIN_BANDS.flatBelow) return 'flat';
  return rateMPerKm > TERRAIN_BANDS.hillyAbove ? 'hilly' : 'rolling';
}

/** 1 inside the asked band, falling off with how far outside it the climb rate is. */
function terrainFit(rate: number | null, wanted: Terrain): number {
  if (wanted === 'any') return 1;
  if (rate == null) return NEUTRAL;
  const [low, high] =
    wanted === 'flat' ? [0, TERRAIN_BANDS.flatBelow] : wanted === 'rolling' ? [TERRAIN_BANDS.flatBelow, TERRAIN_BANDS.hillyAbove] : [TERRAIN_BANDS.hillyAbove, Infinity];
  const gap = rate < low ? low - rate : rate > high ? rate - high : 0;
  return Math.max(0, 1 - gap / TERRAIN_SLACK);
}

/** How long a route takes at a pace, allowing for its climb (none when its elevation is unknown). */
export function estimateDurationS(route: Route, paceSPerKm: number): number {
  const climbM = route.elevationAvailable === false ? 0 : route.gainM;
  return (route.distanceM / 1000) * paceSPerKm + (climbM / 10) * CLIMB_S_PER_10M;
}

/** 1 when the route is exactly the asked length or time, falling to 0 at double (or nothing). */
function lengthFit(route: Route, durationS: number, length: RunLength): number {
  const [actual, target] = measured(route, durationS, length);
  return Math.max(0, 1 - Math.abs(actual - target) / target);
}

/** [the route's, the asked] length: metres for a distance, seconds for a time. */
function measured(route: Route, durationS: number, length: RunLength): [number, number] {
  return length.kind === 'distance' ? [route.distanceM, length.metres] : [durationS, length.minutes * 60];
}

/**
 * How far a route is from where the runner will be: its closest approach to
 * a point; for an area (a country), 0 when it crosses the area and out of
 * reach otherwise.
 */
function awayM(route: Route, where: RunWhere): number {
  if (where.kind === 'point') return distanceToRouteM(route, where.lng, where.lat);
  return routeIntersects(route, where.bounds) ? 0 : Infinity;
}

/** An area is its own reach; a point widens as Routes near me does (10 km, then 50 km). */
const AREA_REACH_M = [0];

/** 1 on the doorstep, a half at 5 km, a sixth at 25 km. */
function closenessFit(metres: number): number {
  return 1 / (1 + metres / CLOSENESS_HALF_M);
}

export interface MatchOptions {
  /** Reach limits around a point, smallest first: the first with any route in it is used. */
  reachM?: number[];
}

export interface MatchResult {
  /** Best first. */
  matches: RouteMatch[];
  /** The reach that was used, or null when no "where" was set or nothing was in reach. */
  reachM: number | null;
}

/**
 * Every route ranked by how well it fits a runner's needs, best first, with a
 * score, a label and the reasons behind it. Routes beyond the reach (when a
 * "where" is set) are left out. Pure: no storage, no React.
 */
export function matchRoutes(routes: Route[], needs: RunNeeds, options: MatchOptions = {}): MatchResult {
  const { where } = needs;
  let inReach: { route: Route; away: number | null }[] = routes.map((route) => ({ route, away: null }));
  let reachM: number | null = null;
  if (where) {
    const measuredAway = routes.map((route) => ({ route, away: awayM(route, where) }));
    const limit = (where.kind === 'area' ? AREA_REACH_M : options.reachM ?? NEAR_ME_RADII_M).find((m) => measuredAway.some((hit) => hit.away <= m));
    reachM = limit ?? null;
    inReach = limit == null ? [] : measuredAway.filter((hit) => hit.away <= limit);
  }

  const matches = inReach.map(({ route, away }): RouteMatch => {
    const durationS = estimateDurationS(route, needs.paceSPerKm);
    const rate = climbRateOf(route);
    const parts: [number, number][] = [[WEIGHTS.terrain, terrainFit(rate, needs.terrain)]];
    if (needs.length) parts.push([WEIGHTS.length, lengthFit(route, durationS, needs.length)]);
    if (away != null) parts.push([WEIGHTS.closeness, closenessFit(away)]);
    const weight = parts.reduce((sum, [w]) => sum + w, 0);
    const score = parts.reduce((sum, [w, fit]) => sum + w * fit, 0) / weight;
    const reasons: MatchReason[] = [
      ...(away != null ? [{ kind: 'away', metres: Math.round(away) } as const] : []),
      { kind: 'length', metres: route.distanceM, durationS },
      { kind: 'terrain', band: rate == null ? null : terrainBand(rate), climbRateMPerKm: rate },
    ];
    const misses: MatchMiss[] = [];
    if (needs.length) {
      const [actual, target] = measured(route, durationS, needs.length);
      if (Math.abs(actual - target) > target * LENGTH_TOLERANCE) {
        misses.push({ kind: 'length', unit: needs.length.kind, by: Math.round(Math.abs(actual - target)), longer: actual > target });
      }
    }
    if (needs.terrain !== 'any' && rate != null && terrainBand(rate) !== needs.terrain) {
      misses.push({ kind: 'terrain', wanted: needs.terrain, band: terrainBand(rate) });
    }
    const label: MatchLabel = score >= LABEL_AT.great ? 'great' : score >= LABEL_AT.good ? 'good' : 'partial';
    return { route, durationS, score, label, misses, awayM: away, reasons };
  });
  matches.sort(
    (a, b) =>
      b.score - a.score ||
      (a.awayM ?? 0) - (b.awayM ?? 0) ||
      Number(b.route.loop) - Number(a.route.loop),
  );
  return { matches, reachM };
}
