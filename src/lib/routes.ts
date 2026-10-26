import type { Route, RouteActivity, RoutePoint, Venue } from '../types';
import { routeActivity } from './routeAnalysis';
import { computeGain, haversineM, totalDistanceM } from './elevation';
import type { Bounds } from './venues';

/**
 * Quick route categories, shown as the icon row in routes mode. Each is a
 * question the route data can answer on its own — no invented tags.
 */
export type RouteCategory = 'all' | RouteActivity | 'saved' | 'device';

/** Same number of slots as the climbs bar, so switching modes does not shift the icons. */
export const ROUTE_CATEGORIES: { id: RouteCategory; label: string; shortLabel: string }[] = [
  { id: 'all', label: 'All routes', shortLabel: 'All' },
  { id: 'run', label: 'Road runs', shortLabel: 'Run' },
  { id: 'trail', label: 'Trails', shortLabel: 'Trail' },
  { id: 'cycle', label: 'Cycling', shortLabel: 'Cycle' },
  { id: 'saved', label: 'Saved', shortLabel: 'Saved' },
  { id: 'device', label: 'On this device', shortLabel: 'Device' },
];

export interface RouteFilters {
  category: RouteCategory;
  minGainM: number | null;
  maxGainM: number | null;
  minDistanceM: number | null;
  maxDistanceM: number | null;
}

export const NO_ROUTE_FILTERS: RouteFilters = {
  category: 'all',
  minGainM: null,
  maxGainM: null,
  minDistanceM: null,
  maxDistanceM: null,
};

export function routeHasElevation(route: Route): boolean {
  return route.elevationAvailable !== false;
}

/** `bookmarks` are the hearted route slugs ("Saved"); "On this device" is GPX files saved locally. */
export function filterRoutes(routes: Route[], filters: RouteFilters, bookmarks: ReadonlySet<string> = new Set()): Route[] {
  return routes.filter((route) => {
    // A gain cap is a question about EG: a route whose elevation is unknown
    // cannot answer it, whatever its stored number says.
    if ((filters.minGainM != null || filters.maxGainM != null) && !routeHasElevation(route)) return false;
    if (filters.minGainM != null && route.gainM < filters.minGainM) return false;
    if (filters.maxGainM != null && route.gainM > filters.maxGainM) return false;
    if (filters.minDistanceM != null && route.distanceM < filters.minDistanceM) return false;
    if (filters.maxDistanceM != null && route.distanceM > filters.maxDistanceM) return false;
    switch (filters.category) {
      case 'run':
      case 'trail':
      case 'cycle':
        return routeActivity(route) === filters.category;
      case 'saved':
        return bookmarks.has(route.slug);
      case 'device':
        return route.source === 'local';
      default:
        return true;
    }
  });
}

export function routeBounds(route: Route): Bounds | null {
  const points = route.coordinates;
  if (points.length === 0) return null;
  let west = points[0][0];
  let east = west;
  let south = points[0][1];
  let north = south;
  for (const [lng, lat] of points) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return { west, south, east, north };
}

export function routeIntersects(route: Route, view: Bounds): boolean {
  const b = routeBounds(route);
  return Boolean(b && b.east >= view.west && b.west <= view.east && b.north >= view.south && b.south <= view.north);
}

/** One box around every route given, or null when none has a point. */
export function routesBounds(routes: Route[]): Bounds | null {
  const boxes = routes.map(routeBounds).filter((b): b is Bounds => Boolean(b));
  if (boxes.length === 0) return null;
  return {
    west: Math.min(...boxes.map((b) => b.west)),
    south: Math.min(...boxes.map((b) => b.south)),
    east: Math.max(...boxes.map((b) => b.east)),
    north: Math.max(...boxes.map((b) => b.north)),
  };
}

/**
 * How far "near me" looks around a point, a step at a time until it finds
 * routes: Routes near me (App.tsx) and the run planner (routeMatch.ts).
 */
export const NEAR_ME_RADII_M = [10_000, 50_000];

/** Further than this from a route, a runner is not on it. */
export const ON_ROUTE_MAX_M = 200;

export interface NearestPoint {
  /** Index into `route.coordinates` of the route point nearest the position. */
  index: number;
  /** How far the position is from the route's line, in metres. */
  distanceM: number;
  /** Within `ON_ROUTE_MAX_M` of the route. */
  onRoute: boolean;
}

/**
 * The point on a route nearest a position (a runner's GPS fix). Distance is
 * measured to the route's line, so a runner between two far-apart points is
 * still on it; the index is whichever end of that stretch is closer, so it
 * can drive a slider over the route's points.
 */
export function nearestPointOnRoute(route: Route, lng: number, lat: number): NearestPoint {
  const pts = route.coordinates;
  // Local flat projection in metres around the position: fine at trail scale.
  const mPerLat = 111_320;
  const mPerLng = mPerLat * Math.cos((lat * Math.PI) / 180);
  const xy = (i: number): [number, number] => [(pts[i][0] - lng) * mPerLng, (pts[i][1] - lat) * mPerLat];
  let best: NearestPoint = { index: 0, distanceM: Infinity, onRoute: false };
  if (pts.length === 0) return best;
  if (pts.length === 1) {
    const d = haversineM(lng, lat, pts[0][0], pts[0][1]);
    return { index: 0, distanceM: d, onRoute: d <= ON_ROUTE_MAX_M };
  }
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = xy(i - 1);
    const [bx, by] = xy(i);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Fraction along the stretch of the foot of the perpendicular from the origin (the runner).
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.distanceM) best = { index: t < 0.5 ? i - 1 : i, distanceM: d, onRoute: false };
  }
  return { ...best, onRoute: best.distanceM <= ON_ROUTE_MAX_M };
}

/** Closest approach of a route to a point, in metres. */
export function distanceToRouteM(route: Route, lng: number, lat: number): number {
  let best = Infinity;
  for (const [pLng, pLat] of route.coordinates) {
    const d = haversineM(lng, lat, pLng, pLat);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Routes passing within `radiusM` of a point, closest first. A route counts
 * by its nearest point, not its start, so a long loop through town is near
 * the town. Routes whose box is clearly out of reach are skipped unmeasured.
 */
export function routesNear(routes: Route[], lng: number, lat: number, radiusM: number, limit: number): Route[] {
  // A degree of latitude is ~111 km; longitude shrinks towards the poles.
  const padLat = radiusM / 111_000;
  const padLng = padLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const reach: Bounds = { west: lng - padLng, south: lat - padLat, east: lng + padLng, north: lat + padLat };
  return routes
    .filter((route) => routeIntersects(route, reach))
    .map((route) => ({ route, d: distanceToRouteM(route, lng, lat) }))
    .filter((hit) => hit.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((hit) => hit.route);
}

/**
 * The routes near a point, widening as needed: the first radius in `radiiM`
 * (smallest first) that has any routes, with up to `limit` of them, closest
 * first. Null when even the widest has none.
 */
export function routesWithin(
  routes: Route[],
  lng: number,
  lat: number,
  radiiM: number[],
  limit: number,
): { radiusM: number; routes: Route[] } | null {
  for (const radiusM of radiiM) {
    const near = routesNear(routes, lng, lat, radiusM, limit);
    if (near.length > 0) return { radiusM, routes: near };
  }
  return null;
}

/** Metres climbed per kilometre — the single number that says how hilly a route is. */
export function climbRate(route: Route): number {
  return route.distanceM > 0 ? route.gainM / (route.distanceM / 1000) : 0;
}

export function routeDifficulty(route: Route): 'Easy' | 'Moderate' | 'Hard' | 'Brutal' {
  if (route.difficulty) return (route.difficulty[0].toUpperCase() + route.difficulty.slice(1)) as 'Easy' | 'Moderate' | 'Hard';
  const rate = climbRate(route);
  const score = route.distanceM / 1000 + route.gainM / 100;
  if (score > 60 || rate > 80) return 'Brutal';
  if (score > 25 || rate > 40) return 'Hard';
  if (score > 10 || rate > 15) return 'Moderate';
  return 'Easy';
}

const DIFFICULTY_ORDER = ['Easy', 'Moderate', 'Hard', 'Brutal'] as const;

/**
 * Mixes difficulty levels in turn: `perLevel` Easy, then Moderate, Hard and
 * Brutal, round and round, most EG first within each level. A level that runs
 * out is skipped; every route appears once.
 */
export function mixByDifficulty(routes: Route[], perLevel = 2): Route[] {
  const levels = DIFFICULTY_ORDER.map((level) =>
    routes.filter((route) => routeDifficulty(route) === level).sort((a, b) => b.gainM - a.gainM),
  );
  const mixed: Route[] = [];
  for (let start = 0; mixed.length < routes.length; start += perLevel) {
    for (const level of levels) mixed.push(...level.slice(start, start + perLevel));
  }
  return mixed;
}

export function linkVenues(points: RoutePoint[], venues: Venue[], radiusM = 150): string[] {
  if (points.length === 0) return [];
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const latPad = radiusM / 111_320;
  const lngPad = radiusM / (111_320 * Math.max(0.1, Math.cos((midLat * Math.PI) / 180)));
  const west = Math.min(...lngs) - lngPad;
  const east = Math.max(...lngs) + lngPad;
  const south = Math.min(...lats) - latPad;
  const north = Math.max(...lats) + latPad;

  return venues
    .filter(
      (venue) =>
        venue.type !== 'hdb_block' &&
        venue.lng >= west &&
        venue.lng <= east &&
        venue.lat >= south &&
        venue.lat <= north,
    )
    .map((venue) => {
      const firstTouch = points.findIndex(
        ([lng, lat]) => haversineM(lng, lat, venue.lng, venue.lat) <= radiusM,
      );
      return { slug: venue.slug, firstTouch };
    })
    .filter((match) => match.firstTouch >= 0)
    .sort((a, b) => a.firstTouch - b.firstTouch)
    .map((match) => match.slug);
}

function shortHash(points: RoutePoint[]): string {
  let hash = 2166136261;
  for (const point of points) {
    const text = `${point[0].toFixed(6)},${point[1].toFixed(6)},${point[2].toFixed(1)};`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  }
  return (hash >>> 0).toString(36).slice(0, 7);
}

export function routeFromPoints(name: string, points: RoutePoint[], venueSlugs: string[]): Route {
  const coordinates = points.map(
    ([lng, lat, elevation]) =>
      [Number(lng.toFixed(6)), Number(lat.toFixed(6)), Number(elevation.toFixed(1))] as RoutePoint,
  );
  const { gainM, lossM } = computeGain(coordinates);
  const baseSlug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'route';
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];

  return {
    slug: `${baseSlug}-${shortHash(coordinates)}`,
    name,
    venueSlugs,
    distanceM: Math.round(totalDistanceM(coordinates)),
    gainM,
    lossM,
    loop: Boolean(first && last && haversineM(first[0], first[1], last[0], last[1]) < 100),
    coordinates,
    source: 'local',
  };
}
