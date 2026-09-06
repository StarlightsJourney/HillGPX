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

/**
 * Data lives under the deployment's base path, not the server root. Vite fills
 * BASE_URL with '/' in dev and with the repository sub-path in a GitHub Pages
 * build, so a root-absolute '/data' would 404 there — and resolves outside the
 * page entirely when dist/index.html is opened straight off disk.
 */
export const DATA_BASE = `${import.meta.env.BASE_URL}data`;

export async function loadDataset(baseUrl = DATA_BASE): Promise<Dataset> {
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
    .sort((a, b) => rankingHeight(b.venue) - rankingHeight(a.venue))
    .slice(0, limit);
}

/**
 * What a venue's height figure actually means.
 *
 * These are different facts and conflating them misleads: Bukit Timah's summit
 * is ~163 m above sea level, but nobody starts at sea level, so the climb from
 * the visitor centre is far less. Presenting the summit as "163 m of climbing"
 * overstates it by a wide margin. Callers must render the two differently.
 */
export type HeightKind = 'gain' | 'summit';

export interface VenueHeight {
  value: number;
  kind: HeightKind;
}

export function venueHeight(venue: Venue): VenueHeight | null {
  if (venue.gainM != null) return { value: venue.gainM, kind: 'gain' };
  if (venue.summitM != null) return { value: venue.summitM, kind: 'summit' };
  return null;
}

/**
 * A single number for sorting only — never for display.
 *
 * Ranking has to put summit-only venues somewhere, and their summit is the best
 * proxy available. Anything user-facing must go through venueHeight() so the
 * label matches the fact.
 */
export function rankingHeight(venue: Venue): number {
  return venue.gainM ?? venue.summitM ?? 0;
}

/** @deprecated Use venueHeight() for display or rankingHeight() for sorting. */
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
