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

export function boundsToHash(b: Bounds): string {
  return `#map/${[b.west, b.south, b.east, b.north].map((n) => n.toFixed(4)).join(',')}`;
}

export function boundsFromHash(hash: string): Bounds | null {
  const match = /^#map\/(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)$/.exec(hash);
  if (!match) return null;
  const [west, south, east, north] = match.slice(1).map(Number);
  return [west, south, east, north].every(Number.isFinite) ? { west, south, east, north } : null;
}
