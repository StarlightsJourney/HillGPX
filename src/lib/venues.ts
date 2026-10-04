import type { Route, RouteDataset, Venue, VenueDataset, VenuePhoto, VenueType } from '../types';
import { haversineM } from './elevation';
import { formatDistanceIn, type Units } from './units';

const FAVORITES_KEY = 'hillgpx:favorites';

/** Saved venue slugs. The key and shape (a JSON array of slugs) are part of the storage contract. */
export function loadFavorites(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveFavorites(favorites: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch {
    return;
  }
}

/** Friendly rounded count: exact under 100, rounded to the hundred above that. */
export function formatCount(n: number): string {
  if (n >= 10_000) return '10,000+';
  if (n >= 5_000) return '5,000+';
  if (n >= 1_000) return '1,000+';
  if (n >= 100) return `${Math.floor(n / 100) * 100}+`;
  return n.toLocaleString();
}

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

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * Data lives under the deployment's base path, not the server root. Vite fills
 * BASE_URL with '/' in dev and with the repository sub-path in a GitHub Pages
 * build, so a root-absolute '/data' would 404 there — and resolves outside the
 * page entirely when dist/index.html is opened straight off disk.
 */
export const DATA_BASE = `${import.meta.env.BASE_URL}data`;

/**
 * Where a venue photo loads from. Committed photos are files under the base
 * path; world-summit photos are Wikimedia Commons links stored as full URLs.
 */
export function photoSrc(photo: VenuePhoto): string {
  return /^https?:\/\//.test(photo.file) ? photo.file : `${import.meta.env.BASE_URL}${photo.file}`;
}

/**
 * Every stored photo of a venue, cover first. `venue.photo` is the cover on
 * every surface (cards, map popup, detail hero); `venue.photos` adds the rest
 * of the build-time gallery. Duplicates are dropped by `photoKey`.
 */
export function venuePhotos(venue: Venue): VenuePhoto[] {
  const all = [venue.photo, ...(venue.photos ?? [])].filter((photo): photo is VenuePhoto => Boolean(photo?.file));
  const seen = new Set<string>();
  return all.filter((photo) => {
    const keys = venuePhotoKeys(photo);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

/**
 * A comparable identity for a photo URL. Wikimedia serves one file under many
 * URLs (a thumb at any width, the original, Special:FilePath, the File: page),
 * so those collapse to the file name; anything else is the URL without its query.
 */
export function photoKey(url: string): string {
  const name = commonsFileName(url);
  return name ? `file:${name.toLowerCase()}` : url.split(/[?#]/)[0];
}

/**
 * The Wikimedia Commons file name behind a Commons URL (upload/thumb file,
 * Special:FilePath, or the File: page), decoded, with underscores for spaces.
 * Null for anything else, including files local to one Wikipedia.
 */
export function commonsFileName(url: string): string | null {
  const clean = url.split(/[?#]/)[0];
  const match =
    /\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\//.exec(clean) ??
    /\/wikipedia\/commons\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)$/.exec(clean) ??
    /commons\.wikimedia\.org\/wiki\/Special:FilePath\/([^/]+)$/.exec(clean) ??
    /commons\.wikimedia\.org\/wiki\/(?:File|Image):([^/]+)$/.exec(clean);
  if (!match) return null;
  let name = match[1];
  try {
    name = decodeURIComponent(name);
  } catch {
    // Keep the raw name; it still compares equal to itself.
  }
  return name.replace(/ /g, '_');
}

/** Keys for a stored photo: its own file and, for Commons copies, the source file page. */
export function venuePhotoKeys(photo: VenuePhoto): string[] {
  const keys = [photoKey(photo.file)];
  if (photo.sourceUrl) {
    const source = photoKey(photo.sourceUrl);
    if (source.startsWith('file:') && !keys.includes(source)) keys.push(source);
  }
  return keys;
}

let datasetPromise: Promise<Dataset> | null = null;

/**
 * Shared between the landing page and the map, so opening the map after the
 * landing rows have loaded costs nothing. A failed load is not cached.
 */
export function loadDataset(baseUrl = DATA_BASE): Promise<Dataset> {
  if (!datasetPromise) {
    datasetPromise = fetchDataset(baseUrl).catch((error: unknown) => {
      datasetPromise = null;
      throw error;
    });
  }
  return datasetPromise;
}

async function fetchDataset(baseUrl: string): Promise<Dataset> {
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

/**
 * Built climbs (stairwells, blocks) are climbed bottom to top, so their number
 * is elevation gain. Hills and mountains are described by their elevation
 * above sea level; gain only exists for a route up them.
 */
const CLIMBED_BOTTOM_TO_TOP: ReadonlySet<VenueType> = new Set(['hdb_block', 'stairs', 'carpark', 'bridge']);

export function venueHeight(venue: Venue): VenueHeight | null {
  if (CLIMBED_BOTTOM_TO_TOP.has(venue.type) && venue.gainM != null) return { value: venue.gainM, kind: 'gain' };
  if (venue.summitM != null) return { value: venue.summitM, kind: 'summit' };
  if (venue.gainM != null) return { value: venue.gainM, kind: 'gain' };
  return null;
}

/** The word printed after a venue's number: EG for built climbs, elevation for terrain. */
export const HEIGHT_LABEL: Record<HeightKind, string> = { gain: 'EG', summit: 'elevation' };

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
  // A view across the antimeridian arrives as west > east or east > 180.
  const within = (lng: number) => lng >= bounds.west && lng <= bounds.east;
  const inLng = (lng: number) =>
    bounds.west <= bounds.east
      ? within(lng) || within(lng + 360) || within(lng - 360)
      : lng >= bounds.west || lng <= bounds.east;
  return venues.filter(
    (v) =>
      inLng(v.lng) &&
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

/**
 * Metric unless told otherwise. The default keeps this usable from anywhere
 * without a units preference to hand — the map layers, a script, a test — while
 * components reach for the bound formatter on the units context instead of
 * threading the argument through by hand.
 */
export function formatDistance(m: number, units: Units = 'metric'): string {
  return formatDistanceIn(m, units);
}

export const VENUE_TYPE_LABEL: Record<VenueType, string> = {
  hill: 'Hill',
  stairs: 'Stairs',
  hdb_block: 'HDB block',
  park: 'Park',
  carpark: 'Multi-storey carpark',
  bridge: 'Overhead bridge',
};

/**
 * The venue types the loaded data actually contains, in the order
 * VENUE_TYPE_LABEL declares them.
 *
 * The type union lists six kinds but today's file holds two, so a filter row
 * built from the union would offer four chips that can only ever return
 * nothing. Deriving the list from the data instead means those chips appear on
 * their own the day someone contributes a staircase or a carpark.
 */
/** "Mountain" for high summits, the type label otherwise: Monte Rosa is not a hill. */
export function venueKindLabel(venue: Venue): string {
  return venue.type === 'hill' && (venue.summitM ?? 0) >= 600 ? 'Mountain' : VENUE_TYPE_LABEL[venue.type];
}

export function presentVenueTypes(venues: Venue[]): VenueType[] {
  const seen = new Set(venues.map((v) => v.type));
  return (Object.keys(VENUE_TYPE_LABEL) as VenueType[]).filter((t) => seen.has(t));
}

/**
 * What the filter row is asking for.
 *
 * An empty `types` means "any type", not "no types" — nobody wants a map with
 * nothing on it, and treating empty as unconstrained saves every caller from
 * seeding the list with all six types before the first render.
 */
export interface VenueFilters {
  types: VenueType[];
  /** Lower bound on rankingHeight() in metres, or null for no bound. */
  minHeightM: number | null;
  /** Upper bound on rankingHeight() in metres, or null for no bound. */
  maxHeightM: number | null;
  notableOnly: boolean;
  withPhoto: boolean;
  /** Only places you have hearted. */
  savedOnly: boolean;
}

export const NO_FILTERS: VenueFilters = {
  types: [],
  minHeightM: null,
  maxHeightM: null,
  notableOnly: false,
  withPhoto: false,
  savedOnly: false,
};

/** How many separate things the filters currently ask for. Drives the badge. */
export function activeFilterCount(filters: VenueFilters): number {
  return (
    filters.types.length +
    // A range narrowed at both ends is one request, not two: someone who asks
    // for 30–60 m has said a single thing about height, and a badge reading 2
    // for it would send them hunting for a second filter they never set.
    (filters.minHeightM != null || filters.maxHeightM != null ? 1 : 0) +
    (filters.notableOnly ? 1 : 0) +
    (filters.withPhoto ? 1 : 0) +
    (filters.savedOnly ? 1 : 0)
  );
}

/**
 * Narrow the venue list to whatever the filters ask for.
 *
 * A linear pass, as the note at the top of this file argues for: ~12k venues
 * scan in well under a frame, and any index would have to be rebuilt on every
 * toggle, which is the one moment the work actually has to be fast.
 *
 * The height bounds are compared against rankingHeight(), so they mix a block's
 * climb with a hill's height above sea level. That is a real conflation and it
 * is the same one the results list already makes when it sorts. Comparing
 * gainM alone would be the worse answer: no hill in the dataset carries one, so
 * asking for anything over 100 m would hide the only venues that clear it.
 */
export function filterVenues(venues: Venue[], filters: VenueFilters, saved: ReadonlySet<string> = new Set()): Venue[] {
  // The same array back when nothing is on, rather than an equal copy. A fresh
  // reference every render would re-sort the results list and push all ~12k
  // features through the map source again for a picture that has not changed.
  if (activeFilterCount(filters) === 0) return venues;

  return venues.filter(
    (v) =>
      (filters.types.length === 0 || filters.types.includes(v.type)) &&
      (filters.minHeightM == null || rankingHeight(v) >= filters.minHeightM) &&
      (filters.maxHeightM == null || rankingHeight(v) <= filters.maxHeightM) &&
      (!filters.notableOnly || Boolean(v.notable)) &&
      (!filters.withPhoto || Boolean(v.photo)) &&
      (!filters.savedOnly || saved.has(v.slug)),
  );
}

/**
 * HDB's town codes, as the ingest stores them, spelled out.
 *
 * A venue's `town` is "HG", not "Hougang", so searching a town name could only
 * ever match the block names that happen to repeat it — and never the hills and
 * parks in the same town, whose names do not. Sending the camera to a place
 * needs the mapping, and it cannot be recovered from the data: guessing a
 * town's name from its commonest street would call Sengkang "Compassvale" and
 * Toa Payoh "Lorong". So it is written out here, for the same reason
 * streetTerms.ts exists — it is knowledge the dataset does not carry.
 */
/**
 * HDB's own town codes, which is what `town` actually holds — `TP`, `HG`, `BM`
 * and so on. They are fine as keys and useless as labels, so anything shown to
 * a reader goes through `townName`.
 */
const TOWN_NAMES: Record<string, string> = {
  AMK: 'Ang Mo Kio',
  BB: 'Bukit Batok',
  BD: 'Bedok',
  BH: 'Bishan',
  BM: 'Bukit Merah',
  BP: 'Bukit Panjang',
  BT: 'Bukit Timah',
  CCK: 'Choa Chu Kang',
  CL: 'Clementi',
  CT: 'Central Area',
  GL: 'Geylang',
  HG: 'Hougang',
  JE: 'Jurong East',
  JW: 'Jurong West',
  KWN: 'Kallang/Whampoa',
  MP: 'Marine Parade',
  PG: 'Punggol',
  PRC: 'Pasir Ris',
  QT: 'Queenstown',
  SB: 'Sembawang',
  SGN: 'Serangoon',
  SK: 'Sengkang',
  TAP: 'Tampines',
  TG: 'Tengah',
  TP: 'Toa Payoh',
  WL: 'Woodlands',
  YS: 'Yishun',
};

/** A named place the camera can be sent to, rather than a single venue. */
export interface Area {
  /** The stored town code, kept because it is the only stable identifier. */
  code: string;
  name: string;
  venueCount: number;
  bounds: Bounds;
}

/** The tightest box containing every point given, or null if there are none. */
/** A town's readable name, falling back to the raw code if it is unmapped. */
export function townName(code: string | null | undefined): string | null {
  if (!code) return null;
  return TOWN_NAMES[code] ?? code;
}

/** Title-case an imported street while preserving numbered blocks and common initialisms. */
export function titleCaseStreet(street: string): string {
  const uppercase = new Set(['HDB', 'MRT', 'CTE']);
  return street
    .toLowerCase()
    .split(/\s+/)
    .map((token) => {
      const upper = token.toUpperCase();
      if (/\d/.test(token) || uppercase.has(upper)) return upper;
      return token.replace(/(^|[-/])([a-z])/g, (_, separator: string, letter: string) => `${separator}${letter.toUpperCase()}`);
    })
    .join(' ');
}

export function boundsOf(points: { lng: number; lat: number }[]): Bounds | null {
  if (points.length === 0) return null;
  let west = points[0].lng;
  let east = points[0].lng;
  let south = points[0].lat;
  let north = points[0].lat;
  for (const p of points) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  return { west, south, east, north };
}

/**
 * Every town in the dataset, as somewhere the map can go.
 *
 * Bounds are taken from the venues themselves rather than from real town
 * boundaries, which the repo does not ship and which would frame the empty
 * industrial and reservoir edges that most HDB towns have. Fitting what is
 * mapped puts the blocks on screen, which is the whole point of going there.
 */
export function buildAreas(venues: Venue[]): Area[] {
  const grouped = new Map<string, Venue[]>();
  for (const venue of venues) {
    if (!venue.town || !TOWN_NAMES[venue.town]) continue;
    const bucket = grouped.get(venue.town);
    if (bucket) bucket.push(venue);
    else grouped.set(venue.town, [venue]);
  }

  const areas: Area[] = [];
  for (const [code, members] of grouped) {
    const bounds = boundsOf(members);
    if (bounds) areas.push({ code, name: TOWN_NAMES[code], venueCount: members.length, bounds });
  }
  return areas;
}

/**
 * Areas whose name contains the query, biggest first.
 *
 * Substring rather than prefix, because people type the distinctive half of a
 * two-word town — "timah", "payoh" — far more often than the first.
 */
export function matchAreas(areas: Area[], normalisedQuery: string, limit = 3): Area[] {
  if (normalisedQuery.length < 2) return [];
  return areas
    .filter((area) => area.name.toLowerCase().includes(normalisedQuery))
    .sort((a, b) => b.venueCount - a.venueCount)
    .slice(0, limit);
}
