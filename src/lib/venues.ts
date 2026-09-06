import type { Route, RouteDataset, Venue, VenueDataset, VenueType } from '../types';
import { haversineM } from './elevation';

/**
 * Venue and route loading, plus the spatial queries the map needs.
 *
 * Everything is served from static JSON. There is no backend, so all filtering
 * and nearest-neighbour work happens here in the browser over the full dataset.
 * At ~10.8k venues a linear scan is well under a frame, so this deliberately uses
 * no spatial index — reach for one only if that stops being true.
 */

export interface Dataset {
  venues: Venue[];
  routes: Route[];
  bySlug: Map<string, Venue>;
  routeBySlug: Map<string, Route>;
}

export async function loadDataset(baseUrl = '/data'): Promise<Dataset> {
  const [venueData, routeData] = await Promise.all([
    fetchJson<VenueDataset>(`${baseUrl}/venues.json`),
    fetchJson<RouteDataset>(`${baseUrl}/routes.json`),
  ]);

  const venues = venueData.venues;
  const routes = routeData.routes;

  return {
    venues,
    routes,
    bySlug: new Map(venues.map((v) => [v.slug, v])),
    routeBySlug: new Map(routes.map((r) => [r.slug, r])),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Could not load ${url} (${res.status}). Run \`npm run data\` to generate the static datasets.`,
    );
  }
  return res.json() as Promise<T>;
}

/** Venues sorted by distance from a point, nearest first. */
export function nearest(venues: Venue[], lng: number, lat: number, limit = 20): Venue[] {
  return venues
    .map((v) => ({ v, d: haversineM(lng, lat, v.lng, v.lat) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map((x) => x.v);
}

/**
 * The core query: the biggest climbs within reach.
 *
 * Sorting by gain alone sends everyone to Bukit Timah; sorting by distance alone
 * sends them to the block next door. This ranks by gain but only among venues
 * inside `radiusM`, which is the question people actually ask — "what is the
 * most elevation I can get to without a long trip?"
 */
export function tallestWithin(
  venues: Venue[],
  lng: number,
  lat: number,
  radiusM = 3000,
  limit = 20,
): { venue: Venue; distanceM: number }[] {
  return venues
    .map((venue) => ({ venue, distanceM: haversineM(lng, lat, venue.lng, venue.lat) }))
    .filter((x) => x.distanceM <= radiusM)
    .sort((a, b) => (effectiveGain(b.venue) ?? 0) - (effectiveGain(a.venue) ?? 0))
    .slice(0, limit);
}

/**
 * The gain figure to rank and display a venue by: the measured climb where we
 * have one, otherwise the summit height as a rough stand-in.
 */
export function effectiveGain(venue: Venue): number | null {
  return venue.gainM ?? venue.summitM ?? null;
}

export function venuesInBounds(
  venues: Venue[],
  bounds: { west: number; south: number; east: number; north: number },
  types?: Set<VenueType>,
): Venue[] {
  return venues.filter(
    (v) =>
      v.lng >= bounds.west &&
      v.lng <= bounds.east &&
      v.lat >= bounds.south &&
      v.lat <= bounds.north &&
      (!types || types.has(v.type)),
  );
}

export function routesForVenue(dataset: Dataset, venue: Venue): Route[] {
  return venue.routeSlugs
    .map((slug) => dataset.routeBySlug.get(slug))
    .filter((r): r is Route => Boolean(r));
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export const VENUE_TYPE_LABEL: Record<VenueType, string> = {
  hill: 'Hill',
  stairs: 'Stairs',
  hdb_block: 'HDB block',
  park: 'Park',
  carpark: 'Multi-storey carpark',
  bridge: 'Overhead bridge',
};
