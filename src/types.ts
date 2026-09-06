/**
 * Core domain model.
 *
 * The unit of the app is a *venue* — somewhere you go to gain elevation. An HDB
 * block is one kind of venue; a hill is another. Venues have zero or more
 * *routes* attached, and a route may span several venues (the Southern Ridges
 * traverse touches Mount Faber, Telok Blangah and Kent Ridge), so the
 * relationship is many-to-many in both directions.
 */

export type VenueType =
  | 'hill' // natural high ground — Bukit Timah, Mount Faber
  | 'stairs' // a dedicated public staircase — Marang Trail, park steps
  | 'hdb_block' // residential block, climbed by stairwell
  | 'park' // park connector / nature park with usable relief
  | 'carpark' // multi-storey carpark
  | 'bridge'; // pedestrian overhead bridge

/**
 * How much we trust a venue's elevation numbers.
 * - `estimated`  — derived by formula (HDB: storeys × 2.8 m) or a rough seed value
 * - `dem`        — sampled from the bundled terrain model
 * - `community`  — someone measured or sourced it and opened a PR
 * - `verified`   — corroborated against an authoritative source
 */
export type ElevationSource = 'estimated' | 'dem' | 'community' | 'verified';

export interface Venue {
  slug: string;
  name: string;
  type: VenueType;
  lat: number;
  lng: number;

  /**
   * Elevation of the top above sea level, in metres. Absent when unknown — the
   * generated dataset omits empty fields rather than writing them out ~10,800
   * times over.
   */
  summitM?: number | null;
  /**
   * Elevation gained from the usual starting point to the top, in metres.
   * This — not `summitM` — is the number that matters for training: Bukit Timah
   * tops out at ~163 m but you only climb ~120 m of it from the visitor centre.
   */
  gainM: number | null;

  elevationSource: ElevationSource;

  /** HDB blocks only. */
  storeys?: number | null;
  yearCompleted?: number | null;
  town?: string | null;
  blkNo?: string | null;
  street?: string | null;

  /** Slugs of routes that touch this venue. Populated at build time. */
  routeSlugs: string[];

  /** Free-text context: access, gate hours, whether the stairwell is open. */
  notes?: string;

  /**
   * Street-level photo from Mapillary, attached at build time. CC-BY-SA, so the
   * credit must be shown wherever the image is.
   */
  photo?: { url: string; credit?: string | null };
}

export type RouteSurface = 'trail' | 'stairs' | 'road' | 'boardwalk' | 'mixed';
export type RouteDifficulty = 'easy' | 'moderate' | 'hard';

/** A single point on a route: [lng, lat, elevation in metres]. */
export type RoutePoint = [number, number, number];

export interface Route {
  slug: string;
  name: string;

  /** Slugs of the venues this route touches, in the order it reaches them. */
  venueSlugs: string[];

  distanceM: number;
  gainM: number;
  lossM: number;
  loop: boolean;

  surface?: RouteSurface;
  difficulty?: RouteDifficulty;

  coordinates: RoutePoint[];

  source: 'curated' | 'community';
  /** GitHub handle of whoever contributed the GPX, for credit. */
  contributor?: string;
  description?: string;
}

/**
 * Header for the bundled terrain model. The elevations themselves live in a
 * sibling `.bin` as a row-major Int16Array running north-to-south, west-to-east.
 */
export interface DemHeader {
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
  /** Value standing in for "no data" in the Int16 grid. */
  noData: number;
  attribution: string;
}

export interface VenueDataset {
  generatedAt: string;
  venues: Venue[];
}

export interface RouteDataset {
  generatedAt: string;
  routes: Route[];
}
