import type { Route, RouteActivity, RoutePoint, Venue } from '../types';
import { simplify, type ParsedGpx } from './gpx';
import { ElevationModel, computeGain, cumulativeDistances, totalDistanceM } from './elevation';
import { linkVenues } from './routes';
import { hasRealElevation, terrainElevations } from './terrain';
import { assessRoute, type QualityAssessment } from './routeQuality';
import { classifyActivity, isSameRoute, routeFingerprint } from './routeAnalysis';

/**
 * The shared tail of every route import: simplify to the point budget,
 * refuse a track the map already has, fill missing elevation, then fold
 * stats into the LoadedRoute the panel publishes from. Used by the GPX
 * dropzone (a file's own text) and the Google Health import (TCX converted
 * to GPX) — keep them identical so a track behaves the same however it
 * arrived.
 */

export interface LoadedRoute {
  name: string;
  points: RoutePoint[];
  distanceM: number;
  gainM: number;
  lossM: number;
  /** Where EG/EL came from: the device, Singapore's terrain model, or worldwide terrain tiles. */
  elevationSource: 'gps' | 'dem' | 'terrain';
  /** Kept for the old panel badge: true when heights were replaced by terrain. */
  resampled: boolean;
  venueSlugs: string[];
  recordedAt: string | null;
  activity: RouteActivity;
  fingerprint: string;
  /** The file exactly as uploaded/imported, stored alongside the simplified track. */
  originalGpx: string;
  /** The track as parsed, before simplification, with its timestamps: the quality checks read these. */
  rawPoints: RoutePoint[];
  rawTimes: (number | null)[];
  /** Whether the file's own heights were real (a device altimeter) rather than filled in. */
  deviceElevation: boolean;
  /** Whether the final track has real heights, from the file or from terrain data. */
  hasElevation: boolean;
}

/**
 * Run the quality checks on the whole track or on the part the uploader kept.
 * `keep` is the kept range as 0–1 fractions of the track's length, the same
 * axis the trim control uses; it is mapped onto the raw points by distance.
 */
export function assessLoaded(loaded: LoadedRoute, activity: RouteActivity, keep: [number, number] | null): QualityAssessment {
  let points = loaded.rawPoints;
  let times = loaded.rawTimes;
  if (keep) {
    const distances = cumulativeDistances(points);
    const total = distances[distances.length - 1] || 1;
    const first = Math.max(0, distances.findIndex((d) => d / total >= keep[0] - 1e-9));
    let last = distances.findIndex((d) => d / total > keep[1] + 1e-9);
    last = last < 0 ? points.length : last;
    points = points.slice(first, Math.max(first + 1, last));
    times = times.slice(first, first + points.length);
  }
  return assessRoute({ points, times, activity, hasElevation: loaded.hasElevation, deviceElevation: loaded.deviceElevation });
}

export type LoadRouteResult = { kind: 'loaded'; loaded: LoadedRoute } | { kind: 'duplicate'; route: Route };

/** Enough detail for the map and profile, small enough to store and draw quickly. */
export const POINT_BUDGET = 4000;

/** Douglas–Peucker with a tolerance that grows until the track fits the point budget. */
export function simplifyToBudget(points: RoutePoint[]): RoutePoint[] {
  let tolerance = 1e-5;
  let out = simplify(points, tolerance);
  while (out.length > POINT_BUDGET && tolerance < 1e-3) {
    tolerance *= 1.6;
    out = simplify(points, tolerance);
  }
  return out;
}

export interface LoadRouteContext {
  elevationModel: ElevationModel | null;
  venues: Venue[];
  /** Everything already on the map, to stop the same track being added twice. */
  existingRoutes: Route[];
  /** Progress line for slow steps (terrain fill); not every caller shows one. */
  onStatus?: (message: string) => void;
}

export async function buildLoadedRoute(
  parsed: ParsedGpx,
  originalGpx: string,
  fallbackName: string,
  { elevationModel, venues, existingRoutes, onStatus }: LoadRouteContext,
): Promise<LoadRouteResult> {
  let points = simplifyToBudget(parsed.points);
  const fingerprint = routeFingerprint(points);
  const duplicate = existingRoutes.find((route) => isSameRoute(points, route));
  if (duplicate) return { kind: 'duplicate', route: duplicate };

  // The file's own elevation wins: it is what the runner's device measured.
  // Only a file with none falls back to Singapore's terrain model, then
  // to worldwide terrain tiles.
  let elevationSource: LoadedRoute['elevationSource'] = 'gps';
  const deviceElevation = hasRealElevation(parsed.points);
  if (!hasRealElevation(points)) {
    const coveredBySg = elevationModel
      ? points.filter(([lng, lat]) => elevationModel.covers(lng, lat)).length / points.length >= 0.5
      : false;
    if (elevationModel && coveredBySg) {
      points = elevationModel.resampleElevation(points);
      elevationSource = 'dem';
    } else {
      onStatus?.('No elevation in this track — measuring it from terrain data…');
      const filled = await terrainElevations(points);
      if (filled) {
        points = filled;
        elevationSource = 'terrain';
      }
    }
  }

  const { gainM, lossM } = computeGain(points);
  return {
    kind: 'loaded',
    loaded: {
      name: parsed.name?.trim() || fallbackName,
      points,
      distanceM: totalDistanceM(points),
      gainM,
      lossM,
      elevationSource,
      resampled: elevationSource !== 'gps',
      venueSlugs: linkVenues(points, venues),
      recordedAt: parsed.startedAt,
      // Speed needs the raw points (aligned with their timestamps); climbing needs the final elevation.
      activity: classifyActivity(parsed.points, gainM, parsed.times),
      fingerprint,
      originalGpx,
      rawPoints: parsed.points,
      rawTimes: parsed.times,
      deviceElevation,
      hasElevation: hasRealElevation(points),
    },
  };
}
