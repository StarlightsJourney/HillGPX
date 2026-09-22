import type { Route, RoutePoint, Venue } from '../types';
import { computeGain, haversineM, totalDistanceM } from './elevation';
import type { Bounds } from './venues';

/**
 * Quick route categories, shown as the icon row in routes mode. Each is a
 * question the route data can answer on its own — no invented tags.
 */
export type RouteCategory = 'all' | 'loop' | 'short' | 'long' | 'climb' | 'saved';

export const ROUTE_CATEGORIES: { id: RouteCategory; label: string; shortLabel: string }[] = [
  { id: 'all', label: 'All routes', shortLabel: 'All' },
  { id: 'climb', label: 'Big climbs', shortLabel: 'Big EG' },
  { id: 'loop', label: 'Loops', shortLabel: 'Loops' },
  { id: 'short', label: 'Under 10 km', shortLabel: '<10 km' },
  { id: 'long', label: 'Ultra 30 km+', shortLabel: '30 km+' },
  { id: 'saved', label: 'On this device', shortLabel: 'Saved' },
];

export interface RouteFilters {
  category: RouteCategory;
  minGainM: number | null;
  maxDistanceM: number | null;
}

export const NO_ROUTE_FILTERS: RouteFilters = { category: 'all', minGainM: null, maxDistanceM: null };

export function filterRoutes(routes: Route[], filters: RouteFilters): Route[] {
  return routes.filter((route) => {
    if (filters.minGainM != null && route.gainM < filters.minGainM) return false;
    if (filters.maxDistanceM != null && route.distanceM > filters.maxDistanceM) return false;
    switch (filters.category) {
      case 'loop':
        return route.loop;
      case 'short':
        return route.distanceM < 10_000;
      case 'long':
        return route.distanceM >= 30_000;
      case 'climb':
        return route.gainM >= 500;
      case 'saved':
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
