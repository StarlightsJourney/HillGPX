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
  /**
   * ISO code → [summit count, west, south, east, north]: the tight box round
   * the globe, so `east` exceeds 180 for a country across the antimeridian.
   */
  byCountry?: Record<string, [number, number, number, number, number]>;
  /** ISO code → geonameids of its landing row (tallest distinct summits, highest first), all in `top`. */
  rows?: Record<string, number[]>;
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

function toVenue(row: PeakRow, size: number, photos?: Map<string, PeakPhoto>): Venue {
  const [id, name, lat, lng, ele, source] = row;
  const [south, west] = tileKeyOf(lat, lng, size).split('_').map(Number);
  const slug = `gn${id}-${token(south)}x${token(west)}`;
  // The landing's stored Commons photo, so map cards and the photo filter see it too.
  const photo = photos?.get(slug);
  return {
    slug,
    name,
    type: 'hill',
    lat,
    lng,
    summitM: ele,
    gainM: null,
    elevationSource: source === 's' ? 'community' : 'dem',
    routeSlugs: [],
    ...(photo && {
      photo: {
        file: photo.url,
        credit: photo.credit || null,
        license: photo.licence || undefined,
        source: 'Wikimedia Commons',
        sourceUrl: photo.pageUrl || undefined,
      },
    }),
  };
}

export function isWorldPeakSlug(slug: string): boolean {
  return /^gn\d+-m?\d+xm?\d+$/.test(slug);
}

function loadTile(key: string, size: number): Promise<Venue[]> {
  let pending = tiles.get(key);
  if (!pending) {
    pending = Promise.all([
      fetch(`${BASE}/${key}.json`).then((r) => (r.ok ? (r.json() as Promise<PeakRow[]>) : [])),
      loadPeakPhotos(),
    ])
      .then(([rows, photos]) => rows.map((row) => toVenue(row, size, photos)))
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
  const keys = new Set<string>();
  for (let s = Math.floor(view.south / size) * size; s < view.north; s += size) {
    for (let w = Math.floor(view.west / size) * size; w < view.east; w += size) {
      // A view across the antimeridian runs past ±180; tiles are keyed within it.
      const key = `${s}_${(((w + 180) % 360) + 360) % 360 - 180}`;
      if (index.cells[key]) keys.add(key);
    }
  }
  if (keys.size > MAX_TILES) {
    const photos = await loadPeakPhotos();
    return index.top.map((row) => toVenue(row, size, photos));
  }
  return (await Promise.all([...keys].map((key) => loadTile(key, size)))).flat();
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
  /** Where its summits are; `east` exceeds 180 for a country across the antimeridian. */
  bounds: Bounds;
  /** Its tallest distinct summits, highest first, with their stored photo when one exists. */
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

let summariesPromise: Promise<CountrySummary[]> | null = null;

/**
 * Every country with mapped summits, most summits first, for the banner, the
 * landing rows and the searches. Peaks carry the same stored photo as on the
 * map (toVenue), so a summit looks the same everywhere.
 */
export function countrySummaries(): Promise<CountrySummary[]> {
  summariesPromise ??= Promise.all([loadPeakIndex(), loadPeakPhotos()]).then(([index, photos]) => {
    if (!index?.byCountry) {
      summariesPromise = null;
      return [];
    }
    const rowsBy = new Map<string, PeakRow[]>();
    const byId = new Map<number, PeakRow>();
    for (const row of index.top) {
      byId.set(row[0], row);
      const list = rowsBy.get(row[6]);
      if (list) list.push(row);
      else rowsBy.set(row[6], [row]);
    }
    const landingRow = (code: string): PeakRow[] => {
      const ids = index.rows?.[code];
      if (ids) return ids.map((id) => byId.get(id)).filter((row): row is PeakRow => Boolean(row));
      // An index from before `rows`: its tallest highlights.
      return (rowsBy.get(code) ?? []).sort((a, b) => b[4] - a[4]).slice(0, 12);
    };
    return Object.entries(index.byCountry)
      .map(([code, [count, west, south, east, north]]) => ({
        code,
        name: countryName(code),
        count,
        bounds: { west, south, east, north },
        peaks: landingRow(code).map((row) => toVenue(row, index.tile, photos)),
      }))
      .sort((a, b) => b.count - a.count);
  });
  return summariesPromise;
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
