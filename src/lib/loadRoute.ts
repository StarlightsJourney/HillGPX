import type { Route, RouteActivity, RoutePoint, Venue } from '../types';
import { simplify, type ParsedGpx } from './gpx';
import { ElevationModel, computeGain, totalDistanceM } from './elevation';
import { linkVenues } from './routes';
import { hasRealElevation, terrainElevations } from './terrain';
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
    },
  };
}
