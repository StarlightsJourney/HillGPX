import type { Venue } from '../types';
import { DATA_BASE, type Bounds } from './venues';

/**
 * Worldwide summits (GeoNames, CC BY 4.0), built by scripts/fetch_world_peaks.py
 * into 5° tiles. Nothing here is loaded on the landing page except the small
 * index; the map fetches only the tiles on screen.
 *
 * Slugs carry their tile (`gn<id>-<south>x<west>`, negatives as `m`), so a
 * shared link or a saved favourite can find its summit without a lookup table.
 */

/** [geonameid, name, lat, lng, elevation, 's'urveyed | 'd'em, country, feature] */
type PeakRow = [number, string, number, number, number, 's' | 'd', string, string];

export interface PeakIndex {
  tile: number;
  total: number;
  countries: number;
  /** ISO code → [summit count, west, south, east, north]. */
  byCountry?: Record<string, [number, number, number, number, number]>;
  cells: Record<string, number>;
  top: PeakRow[];
}

const BASE = `${DATA_BASE}/peaks`;
let indexPromise: Promise<PeakIndex | null> | null = null;
const tiles = new Map<string, Promise<Venue[]>>();

export function loadPeakIndex(): Promise<PeakIndex | null> {
  indexPromise ??= fetch(`${BASE}/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<PeakIndex>) : null))
    .catch(() => {
      indexPromise = null;
      return null;
    });
  return indexPromise;
}

const token = (n: number) => (n < 0 ? `m${-n}` : String(n));
const untoken = (t: string) => (t.startsWith('m') ? -Number(t.slice(1)) : Number(t));

function tileKeyOf(lat: number, lng: number, size: number): string {
  return `${Math.floor(lat / size) * size}_${Math.floor(lng / size) * size}`;
}

function toVenue(row: PeakRow, size: number): Venue {
  const [id, name, lat, lng, ele, source] = row;
  const [south, west] = tileKeyOf(lat, lng, size).split('_').map(Number);
  return {
    slug: `gn${id}-${token(south)}x${token(west)}`,
    name,
    type: 'hill',
    lat,
    lng,
    summitM: ele,
    gainM: null,
    elevationSource: source === 's' ? 'community' : 'dem',
    routeSlugs: [],
  };
}

export function isWorldPeakSlug(slug: string): boolean {
  return /^gn\d+-m?\d+xm?\d+$/.test(slug);
}

function loadTile(key: string, size: number): Promise<Venue[]> {
  let pending = tiles.get(key);
  if (!pending) {
    pending = fetch(`${BASE}/${key}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<PeakRow[]>) : []))
      .then((rows) => rows.map((row) => toVenue(row, size)))
      .catch(() => {
        tiles.delete(key);
        return [];
      });
    tiles.set(key, pending);
  }
  return pending;
}

/** Above this span the map shows only each tile's tallest few, from the index. */
const MAX_TILES = 16;

/** Summits for a viewport: full tiles when zoomed in, the index's highlights when not. */
export async function peaksInView(view: Bounds): Promise<Venue[]> {
  const index = await loadPeakIndex();
  if (!index) return [];
  const size = index.tile;
  const keys: string[] = [];
  for (let s = Math.floor(view.south / size) * size; s < view.north; s += size) {
    for (let w = Math.floor(view.west / size) * size; w < view.east; w += size) {
      const key = `${s}_${w}`;
      if (index.cells[key]) keys.push(key);
    }
  }
  if (keys.length > MAX_TILES) return index.top.map((row) => toVenue(row, size));
  return (await Promise.all(keys.map((key) => loadTile(key, size)))).flat();
}

/** Find one summit by slug (for links and favourites), loading just its tile. */
export async function worldPeakBySlug(slug: string): Promise<Venue | null> {
  const match = /^gn\d+-(m?\d+)x(m?\d+)$/.exec(slug);
  const index = await loadPeakIndex();
  if (!match || !index) return null;
  const key = `${untoken(match[1])}_${untoken(match[2])}`;
  const venues = await loadTile(key, index.tile);
  return venues.find((venue) => venue.slug === slug) ?? null;
}

export interface CountrySummary {
  code: string;
  name: string;
  count: number;
  /** Null when the country straddles the antimeridian and a box would span the globe. */
  bounds: Bounds | null;
  /** Its tallest summits from the index highlights, highest first. */
  peaks: Venue[];
}

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl
  ? new Intl.DisplayNames(['en'], { type: 'region' })
  : null;

export function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Every country with mapped summits, most summits first, for the banner and the landing rows. */
export async function countrySummaries(): Promise<CountrySummary[]> {
  const index = await loadPeakIndex();
  if (!index?.byCountry) return [];
  const peaksBy = new Map<string, Venue[]>();
  for (const row of index.top) {
    const list = peaksBy.get(row[6]);
    const venue = toVenue(row, index.tile);
    if (list) list.push(venue);
    else peaksBy.set(row[6], [venue]);
  }
  return Object.entries(index.byCountry)
    .map(([code, [count, west, south, east, north]]) => ({
      code,
      name: countryName(code),
      count,
      bounds: east - west > 180 ? null : { west, south, east, north },
      peaks: (peaksBy.get(code) ?? []).sort((a, b) => (b.summitM ?? 0) - (a.summitM ?? 0)).slice(0, 12),
    }))
    .sort((a, b) => b.count - a.count);
}

export interface PeakPhoto {
  url: string;
  pageUrl: string;
  credit: string;
  licence: string;
}

let photosPromise: Promise<Map<string, PeakPhoto>> | null = null;

async function fetchPeakPhotos(): Promise<Map<string, PeakPhoto>> {
  const map = new Map<string, PeakPhoto>();
  try {
    const response = await fetch(`${BASE}/photos.json`);
    if (!response.ok) return map;
    const data = (await response.json()) as { photos: Record<string, string[]> };
    for (const [slug, value] of Object.entries(data.photos)) {
      const [url, pageUrl = '', credit = '', licence = ''] = value;
      if (url) map.set(slug, { url, pageUrl, credit, licence });
    }
  } catch {
    // Placeholders are fine.
  }
  return map;
}

/** Commons/Wikipedia photos for the landing summits (scripts/fetch_peak_photos.py); links only. */
export function loadPeakPhotos(): Promise<Map<string, PeakPhoto>> {
  photosPromise ??= fetchPeakPhotos();
  return photosPromise;
}
