/**
 * Community storage: reviews, photos and GPX routes, shared through Supabase.
 *
 * The browser talks to Supabase's REST and Storage APIs directly with the
 * project's *publishable* key. That key is meant to be public: row-level
 * security only lets anonymous visitors insert new rows and read approved
 * ones (see supabase/migrations/). Photos wait for a maintainer's approval;
 * reviews and routes publish immediately. No account is needed to contribute.
 *
 * Point a fork at its own project with VITE_SUPABASE_URL and VITE_SUPABASE_KEY.
 */
import type { Route, RouteActivity, RoutePoint } from '../types';
import { toGpx } from './gpx';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://dzpgnebkyubeptitzjlj.supabase.co';
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) || 'sb_publishable_invDmVPb4d4aKqTMTRp72w_hpFBZ0AI';

export interface Review {
  id: string;
  venueSlug: string;
  rating: number;
  comment: string;
  author: string;
  createdAt: string;
}

export interface CommunityPhoto {
  id: string;
  venueSlug: string;
  url: string;
  credit: string;
  licence: string;
  author: string;
  createdAt: string;
}

export interface CommunityStats {
  routes: number;
  photos: number;
  reviews: number;
  routeVenues: string[];
  photoVenues: string[];
}

const AUTHOR_KEY = 'hillgpx:authorName';

export function loadAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) || '';
  } catch {
    return '';
  }
}

export function saveAuthor(author: string): void {
  try {
    localStorage.setItem(AUTHOR_KEY, author);
  } catch {
    // Private mode: the name is a convenience, not data.
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * The sentence to show for a failed request. The database's spam limits
 * (supabase/migrations/20261006000000_spam_limits.sql) raise plain messages
 * meant for people; a storage policy refusal means the hourly upload ceiling.
 */
export function apiErrorMessage(body: string, status: number): string {
  let message = body;
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    if (typeof parsed.message === 'string') message = parsed.message;
  } catch {
    // Not JSON: keep the text as it came.
  }
  if (/row-level security/i.test(message)) return 'Uploads are paused for a little while because of heavy traffic. Please try again later.';
  return message || `Something went wrong (HTTP ${status}).`;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ApiError(apiErrorMessage(body, response.status), response.status);
  }
  return (response.status === 204 || response.status === 201 ? undefined : await response.json()) as T;
}

async function upload(bucket: string, path: string, body: Blob, contentType: string): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': contentType, 'x-upsert': 'false' },
    body,
  });
  if (!response.ok) throw new ApiError(apiErrorMessage(await response.text().catch(() => ''), response.status), response.status);
  return publicUrl(bucket, path);
}

const publicUrl = (bucket: string, path: string) => `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;

const id = () => crypto.randomUUID();
const storageSafe = (text: string) => text.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'x';
const enc = encodeURIComponent;

/* ─── Reviews ──────────────────────────────────────────────────────────── */

interface ReviewRow {
  id: string;
  venue_slug: string;
  rating: number;
  comment: string;
  author: string | null;
  created_at: string;
}

const toReview = (row: ReviewRow): Review => ({
  id: row.id,
  venueSlug: row.venue_slug,
  rating: row.rating,
  comment: row.comment,
  author: row.author || 'Anonymous',
  createdAt: row.created_at,
});

export async function fetchReviews(venueSlug: string): Promise<Review[]> {
  const rows = await rest<ReviewRow[]>(
    `/rest/v1/reviews?venue_slug=eq.${enc(venueSlug)}&select=id,venue_slug,rating,comment,author,created_at&order=created_at.desc&limit=200`,
  );
  return rows.map(toReview);
}

export async function submitReview(input: { venueSlug: string; rating: number; comment: string; author: string }): Promise<Review> {
  const review: Review = {
    id: id(),
    venueSlug: input.venueSlug,
    rating: input.rating,
    comment: input.comment.trim().slice(0, 1000),
    author: input.author.trim().slice(0, 60) || 'Anonymous',
    createdAt: new Date().toISOString(),
  };
  await rest('/rest/v1/reviews', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ id: review.id, venue_slug: review.venueSlug, rating: review.rating, comment: review.comment, author: review.author }),
  });
  return review;
}

/** Published ratings from the build plus live community reviews, as one figure. */
export function combinedRating(
  published: { average: number; count: number } | undefined,
  reviews: Review[],
): { average: number; count: number } | undefined {
  const publishedCount = published?.count ?? 0;
  const count = publishedCount + reviews.length;
  if (count === 0) return undefined;
  const sum = (published?.average ?? 0) * publishedCount + reviews.reduce((acc, r) => acc + r.rating, 0);
  return { average: Math.round((sum / count) * 100) / 100, count };
}

/* ─── Photos ───────────────────────────────────────────────────────────── */

interface PhotoRow {
  id: string;
  venue_slug: string;
  storage_path: string;
  credit: string | null;
  licence: string;
  author: string | null;
  created_at: string;
}

export async function fetchPhotos(venueSlug: string): Promise<CommunityPhoto[]> {
  const rows = await rest<PhotoRow[]>(
    `/rest/v1/photos?venue_slug=eq.${enc(venueSlug)}&select=id,venue_slug,storage_path,credit,licence,author,created_at&order=created_at.desc&limit=60`,
  );
  return rows.map((row) => ({
    id: row.id,
    venueSlug: row.venue_slug,
    url: publicUrl('photos', row.storage_path),
    credit: row.credit || row.author || 'A contributor',
    licence: row.licence,
    author: row.author || 'Anonymous',
    createdAt: row.created_at,
  }));
}

/** Downscale to at most 2048 px on the long edge and re-encode as JPEG (also strips EXIF location). */
async function preparePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image'))), 'image/jpeg', 0.86),
  );
}

export async function submitPhoto(input: { venueSlug: string; file: File; credit: string; licence: string; author: string }): Promise<void> {
  if (!input.file.type.startsWith('image/')) throw new Error('That file is not an image.');
  const blob = await preparePhoto(input.file);
  const photoId = id();
  const path = `${storageSafe(input.venueSlug)}/${photoId}.jpg`;
  await upload('photos', path, blob, 'image/jpeg');
  await rest('/rest/v1/photos', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: photoId,
      venue_slug: input.venueSlug,
      storage_path: path,
      credit: input.credit.trim().slice(0, 120) || null,
      licence: input.licence.trim().slice(0, 60) || 'CC BY-SA 4.0',
      author: input.author.trim().slice(0, 60) || null,
    }),
  });
}

/* ─── Routes ───────────────────────────────────────────────────────────── */

interface RouteRow {
  slug: string;
  name: string;
  activity: RouteActivity;
  recorded_at: string | null;
  distance_m: number;
  gain_m: number;
  loss_m: number;
  elevation_source: 'gps' | 'terrain' | 'dem';
  venue_slugs: string[];
  points: RoutePoint[];
  gpx_path: string;
  contributor: string | null;
  licence: string;
  created_at: string;
}

const ROUTE_FIELDS = 'slug,name,activity,recorded_at,distance_m,gain_m,loss_m,elevation_source,venue_slugs,points,gpx_path,contributor,licence,created_at';

function toRoute(row: RouteRow): Route {
  const first = row.points[0];
  const last = row.points[row.points.length - 1];
  return {
    slug: row.slug,
    name: row.name,
    venueSlugs: row.venue_slugs,
    distanceM: row.distance_m,
    gainM: row.gain_m,
    lossM: row.loss_m,
    elevationAvailable: true,
    loop: Boolean(first && last && Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.001),
    coordinates: row.points,
    source: 'community',
    contributor: row.contributor ?? undefined,
    licence: row.licence,
    activity: row.activity,
    recordedAt: row.recorded_at ?? undefined,
    elevationSource: row.elevation_source,
    gpxUrl: publicUrl('gpx', row.gpx_path),
  };
}

export async function fetchCommunityRoutes(): Promise<Route[]> {
  const rows = await rest<RouteRow[]>(`/rest/v1/routes?select=${ROUTE_FIELDS}&order=created_at.desc&limit=1000`);
  return rows.map(toRoute);
}

export class DuplicateRouteError extends Error {}

export interface PublishRouteInput {
  route: Route;
  activity: RouteActivity;
  fingerprint: string;
  recordedAt: string | null;
  elevationSource: 'gps' | 'terrain' | 'dem';
  originalGpx: string | null;
  contributor: string;
  licence: string;
}

/** Store the GPX file and its row. The database rejects a second copy of the same track. */
export async function publishRoute(input: PublishRouteInput): Promise<Route> {
  const { route } = input;
  // Originals are gzipped: a 50 MB ultra GPX becomes a few MB, inside the bucket limit.
  const canGzip = typeof CompressionStream !== 'undefined';
  const gpxPath = `${storageSafe(route.slug)}.gpx${canGzip ? '.gz' : ''}`;
  const lngs = route.coordinates.map((p) => p[0]);
  const lats = route.coordinates.map((p) => p[1]);
  const row = {
    slug: storageSafe(route.slug),
    name: route.name.slice(0, 120),
    activity: input.activity,
    recorded_at: input.recordedAt,
    distance_m: route.distanceM,
    gain_m: route.gainM,
    loss_m: route.lossM,
    elevation_source: input.elevationSource,
    geom_hash: input.fingerprint,
    west: Math.min(...lngs),
    south: Math.min(...lats),
    east: Math.max(...lngs),
    north: Math.max(...lats),
    venue_slugs: route.venueSlugs.slice(0, 200),
    points: route.coordinates.slice(0, 5000),
    gpx_path: gpxPath,
    contributor: input.contributor.trim().slice(0, 60) || null,
    licence: input.licence,
  };
  const existing = await rest<{ slug: string }[]>(`/rest/v1/routes?geom_hash=eq.${enc(input.fingerprint)}&select=slug&limit=1`);
  if (existing.length > 0) throw new DuplicateRouteError('This exact track is already in the community archive.');
  // Heart rate, cadence, power and other device extensions are personal data
  // and most of a watch file's size: the archive keeps the track, not the body.
  const original = input.originalGpx?.replace(/<extensions>[\s\S]*?<\/extensions>/g, '');
  const file = new Blob([original ?? toGpx(route.name, route.coordinates)], { type: 'application/gpx+xml' });
  const body = canGzip ? await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob() : file;
  try {
    await upload('gpx', gpxPath, body, canGzip ? 'application/gzip' : 'application/gpx+xml');
  } catch (error) {
    // The same slug means the same file name and track hash; anything else is a real failure.
    if (!(error instanceof ApiError && (error.status === 409 || error.message.includes('Duplicate')))) throw error;
  }
  try {
    await rest('/rest/v1/routes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) throw new DuplicateRouteError('This track is already in the community archive.');
    throw error;
  }
  return toRoute({ ...row, created_at: new Date().toISOString(), contributor: row.contributor, recorded_at: row.recorded_at });
}

/* ─── Stats ────────────────────────────────────────────────────────────── */

let statsPromise: Promise<CommunityStats | null> | null = null;

export function communityStats(): Promise<CommunityStats | null> {
  statsPromise ??= rest<CommunityStats>('/rest/v1/rpc/community_stats', { method: 'POST', body: '{}' }).catch(() => {
    statsPromise = null;
    return null;
  });
  return statsPromise;
}

/* ─── Reports ──────────────────────────────────────────────────────────── */

export type ReportKind = 'wrong_details' | 'hazard' | 'closed' | 'photo' | 'other';

/** File a report for a maintainer to review (wrong details, hazards, closures, a bad photo). */
export async function submitReport(input: { targetType: 'venue' | 'route'; targetSlug: string; kind: ReportKind; message: string; author: string }): Promise<void> {
  await rest('/rest/v1/reports', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      target_type: input.targetType,
      target_slug: input.targetSlug,
      kind: input.kind,
      message: input.message.trim().slice(0, 1000),
      author: input.author.trim().slice(0, 60) || null,
    }),
  });
}

/* ─── Photos and hazards along a route ─────────────────────────────────── */

export interface RoutePhoto {
  id: string;
  routeSlug: string;
  lng: number;
  lat: number;
  kind: 'photo' | 'hazard';
  caption: string;
  url: string;
  author: string;
  createdAt: string;
  /** Only on the uploader's own copy, before a volunteer has approved it. */
  pending?: boolean;
}

interface RoutePhotoRow {
  id: string;
  route_slug: string;
  lng: number;
  lat: number;
  kind: 'photo' | 'hazard';
  caption: string | null;
  storage_path: string;
  author: string | null;
  created_at: string;
}

export async function fetchRoutePhotos(routeSlug: string): Promise<RoutePhoto[]> {
  const rows = await rest<RoutePhotoRow[]>(
    `/rest/v1/route_photos?route_slug=eq.${enc(routeSlug)}&select=id,route_slug,lng,lat,kind,caption,storage_path,author,created_at&order=created_at.desc&limit=200`,
  );
  return rows.map((row) => ({
    id: row.id,
    routeSlug: row.route_slug,
    lng: row.lng,
    lat: row.lat,
    kind: row.kind,
    caption: row.caption ?? '',
    url: publicUrl('photos', row.storage_path),
    author: row.author || 'A contributor',
    createdAt: row.created_at,
  }));
}

/** Pin a photo (or a hazard) to a point on a route. Shown after a volunteer approves it. */
export async function submitRoutePhoto(input: { routeSlug: string; lng: number; lat: number; kind: 'photo' | 'hazard'; caption: string; file: File; author: string }): Promise<RoutePhoto> {
  if (!input.file.type.startsWith('image/')) throw new Error('That file is not an image.');
  const blob = await preparePhoto(input.file);
  const photoId = id();
  const path = `route-${storageSafe(input.routeSlug).slice(0, 70)}/${photoId}.jpg`;
  await upload('photos', path, blob, 'image/jpeg');
  await rest('/rest/v1/route_photos', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      id: photoId,
      route_slug: input.routeSlug,
      lng: input.lng,
      lat: input.lat,
      kind: input.kind,
      caption: input.caption.trim().slice(0, 280) || null,
      storage_path: path,
      author: input.author.trim().slice(0, 60) || null,
    }),
  });
  return {
    id: photoId,
    routeSlug: input.routeSlug,
    lng: input.lng,
    lat: input.lat,
    kind: input.kind,
    caption: input.caption.trim(),
    url: publicUrl('photos', path),
    author: input.author.trim() || 'You',
    createdAt: new Date().toISOString(),
    pending: true,
  };
}

/* ─── Route card thumbnails ────────────────────────────────────────────── */

/** Where a community route's rendered card basemap lives (see src/map/renderThumb.ts). */
export function communityThumbUrl(slug: string, viewKey: string): string {
  return publicUrl('route-thumbs', `${storageSafe(slug)}-${viewKey}.jpg`);
}

export async function uploadRouteThumb(slug: string, viewKey: string, blob: Blob): Promise<void> {
  try {
    await upload('route-thumbs', `${storageSafe(slug)}-${viewKey}.jpg`, blob, 'image/jpeg');
  } catch (error) {
    // Already rendered by an earlier publish of the same track: fine.
    if (!(error instanceof ApiError && (error.status === 409 || error.message.includes('Duplicate')))) throw error;
  }
}
