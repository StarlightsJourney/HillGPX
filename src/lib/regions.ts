import type { Bounds } from './venues';

/**
 * Coarse country boxes, checked in order — Singapore before Malaysia, Hong
 * Kong before the rest. Good enough to label a card "Hill in Taiwan"; not a
 * geocoder, and nothing here is used for anything that needs a border.
 */
const COUNTRIES: { name: string; bounds: Bounds }[] = [
  { name: 'Singapore', bounds: { west: 103.6, south: 1.16, east: 104.1, north: 1.48 } },
  { name: 'Hong Kong', bounds: { west: 113.82, south: 22.15, east: 114.44, north: 22.57 } },
  { name: 'Taiwan', bounds: { west: 119.3, south: 21.8, east: 122.1, north: 25.4 } },
  { name: 'Malaysia', bounds: { west: 99.6, south: 0.85, east: 119.3, north: 7.4 } },
  { name: 'Thailand', bounds: { west: 97.3, south: 5.6, east: 105.7, north: 20.5 } },
  { name: 'Vietnam', bounds: { west: 102.1, south: 8.4, east: 109.5, north: 23.4 } },
  { name: 'Philippines', bounds: { west: 116.9, south: 4.6, east: 126.6, north: 21.1 } },
  { name: 'Indonesia', bounds: { west: 95, south: -11, east: 141, north: 6 } },
  { name: 'Japan', bounds: { west: 129.4, south: 30.9, east: 145.9, north: 45.6 } },
  { name: 'South Korea', bounds: { west: 125.8, south: 33.1, east: 129.6, north: 38.7 } },
  { name: 'Australia', bounds: { west: 112.9, south: -43.7, east: 153.7, north: -10.6 } },
  { name: 'New Zealand', bounds: { west: 166.4, south: -47.3, east: 178.6, north: -34.4 } },
];

export function regionOf(lng: number, lat: number): string | null {
  const hit = COUNTRIES.find(
    ({ bounds: b }) => lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north,
  );
  return hit?.name ?? null;
}

export interface Destination {
  name: string;
  hint: string;
  bounds: Bounds;
}

/** Places the landing search offers before anything is typed. */
export const DESTINATIONS: Destination[] = [
  { name: 'Singapore', hint: 'HDB blocks, Bukit Timah, Southern Ridges', bounds: COUNTRIES[0].bounds },
  { name: 'Bukit Timah', hint: 'Singapore’s highest hill', bounds: { west: 103.76, south: 1.33, east: 103.8, north: 1.37 } },
  { name: 'Johor', hint: 'Gunung Pulai, Gunung Lambak', bounds: { west: 102.8, south: 1.3, east: 104.4, north: 2.6 } },
  { name: 'Kluang', hint: 'Gunung Lambak trail runs', bounds: { west: 103.25, south: 1.95, east: 103.42, north: 2.1 } },
  { name: 'Kuala Lumpur', hint: 'Bukit Tabur, Broga Hill', bounds: { west: 101.5, south: 2.9, east: 101.95, north: 3.35 } },
  { name: 'Peninsular Malaysia', hint: 'Over a thousand named summits', bounds: { west: 99.6, south: 1.2, east: 104.6, north: 6.8 } },
  { name: 'Hong Kong', hint: 'Lion Rock, Tai Mo Shan', bounds: COUNTRIES[1].bounds },
  { name: 'Taiwan', hint: 'Yushan and the Central Range', bounds: COUNTRIES[2].bounds },
];

/** The coarse box of a region named by regionOf(), so a row titled with it can open there. */
export function regionBounds(name: string): Bounds | null {
  return COUNTRIES.find((country) => country.name === name)?.bounds ?? null;
}

/** Lower-case, accents off, so "Sao Tome" finds "São Tomé" and "zurich" finds "Zürich". */
export function normalisePlace(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const PHOTON = 'https://photon.komoot.io/api/';

interface PhotonResponse {
  features?: {
    geometry?: { coordinates?: [number, number] };
    properties?: { extent?: [number, number, number, number] };
  }[];
}

/**
 * A box for any place name, from Photon (OpenStreetMap data, keyless, CORS).
 * Used only when someone submits a search that matches nothing we know.
 * Resolves to null when nothing is found; rejects on a network failure or
 * after 8 s, so callers can tell "no such place" from "could not ask".
 *
 * Photon's `extent` is [west, north, east, south]. A place that circles the
 * globe in it (Fiji: -180…180) or has none (a peak, a hut) is framed around
 * its point instead.
 */
export async function geocodePlace(query: string, signal?: AbortSignal): Promise<Bounds | null> {
  const q = query.trim();
  if (!q) return null;
  const timeout = new AbortController();
  const timer = window.setTimeout(() => timeout.abort(), 8000);
  const abort = () => timeout.abort();
  signal?.addEventListener('abort', abort);
  try {
    const response = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=1&lang=en`, { signal: timeout.signal });
    if (!response.ok) throw new Error(`Place search failed (${response.status})`);
    const feature = ((await response.json()) as PhotonResponse).features?.[0];
    if (!feature) return null;
    const extent = feature.properties?.extent;
    if (extent && extent.every(Number.isFinite)) {
      const [w, n, e, s] = extent;
      const west = Math.min(w, e);
      const east = Math.max(w, e);
      if (east - west < 300) return { west, south: Math.min(s, n), east, north: Math.max(s, n) };
    }
    const point = feature.geometry?.coordinates;
    if (!point || !point.every(Number.isFinite)) return null;
    const pad = extent ? 2 : 0.08;
    const [lng, lat] = point;
    return { west: lng - pad, south: lat - pad, east: lng + pad, north: lat + pad };
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/**
 * The map's hash for a box. `east` may be above 180 when the box crosses the
 * antimeridian (a country box from the peak index, e.g. Fiji 177…181);
 * MapLibre's fitBounds reads that as "carry on east".
 */
export function boundsToHash(b: Bounds): string {
  return `#map/${[b.west, b.south, b.east, b.north].map((n) => n.toFixed(4)).join(',')}`;
}

export function boundsFromHash(hash: string): Bounds | null {
  const match = /^#map\/(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/.exec(hash);
  if (!match) return null;
  const [west, south, east, north] = match.slice(1).map(Number);
  return [west, south, east, north].every(Number.isFinite) ? { west, south, east, north } : null;
}

/** Names Intl does not give but people type. Keyed by ISO code. */
export const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ['usa', 'us', 'america', 'united states of america'],
  GB: ['uk', 'britain', 'great britain', 'england', 'scotland', 'wales'],
  KR: ['korea'],
  KP: ['north korea'],
  CZ: ['czech republic'],
  NL: ['holland'],
  TR: ['turkey', 'turkiye'],
  MM: ['burma'],
  CI: ['ivory coast'],
  AE: ['uae'],
  CD: ['drc', 'democratic republic of the congo'],
  SZ: ['swaziland'],
  MK: ['macedonia'],
  CV: ['cape verde'],
  TL: ['east timor'],
};
