/**
 * Community storage: reviews, photos and GPX routes, shared through Supabase.
 *
 * The browser talks to Supabase's REST and Storage APIs directly with the
 * project's *publishable* key. That key is meant to be public: row-level
 * security only lets anonymous visitors insert new rows and read approved
 * ones (see supabase/migrations/). Routes, reviews and photos publish
 * immediately and stay up unless reported; no account is needed to
 * contribute. Signed-in calls carry the Supabase Auth session token, which
 * is what stamps a published route with its owner's id.
 *
 * Accounts (src/lib/auth.ts) use the shared `supabase` client. Point a fork
 * at its own project with VITE_SUPABASE_URL and VITE_SUPABASE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { track } from './analytics';
import { MODERATION_MESSAGES, blobToBase64, moderate, moderateImage, moderateText, refusalMessage } from './moderate';
import type { Route, RouteActivity, RoutePoint } from '../types';
import { toGpx } from './gpx';
import type { QualityFlag } from './routeQuality';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://dzpgnebkyubeptitzjlj.supabase.co';
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_KEY as string | undefined) || 'sb_publishable_invDmVPb4d4aKqTMTRp72w_hpFBZ0AI';

/** Shared client: auth.js signs in and out through it, and its session
 *  token authenticates the REST and Storage calls below. */
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/**
 * The sentence to show for a failed request. The database's spam limits and
 * owner checks raise plain messages meant for people — those arrive with
 * errcode P0001 and pass through as written. Everything else (PostgREST
 * schema errors, storage refusals, raw SQL) is engine noise: the site shows
 * one generic line instead.
 */
export function apiErrorMessage(body: string, status: number): string {
  let message = body;
  let code = '';
  try {
    const parsed = JSON.parse(body) as { message?: unknown; code?: unknown };
    if (typeof parsed.message === 'string') message = parsed.message;
    if (typeof parsed.code === 'string') code = parsed.code;
  } catch {
    // Not JSON: keep the text as it came.
  }
  if (/row-level security/i.test(message)) return 'Uploads are paused for a little while because of heavy traffic. Please try again later.';
  if (code === 'P0001') return message;
  if (code === '23505' && message.includes('route_reviews')) return 'You have already reviewed this route.';
  return `Something went wrong (HTTP ${status}).`;
}

/**
 * The sentence a form may show for a caught error. ApiError text is written
 * for people; anything else — a dropped connection, a parser failure — gets
 * the generic line, never its raw message.
 */
export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong — please try again.';
}

/** PostgREST/Postgres errcode in an error body (42703 missing column,
 *  42P01 missing table, PGRST2xx schema-cache misses). Storage errors carry
 *  the status in `statusCode` instead — often as "409" with HTTP 400. */
function apiErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { code?: unknown; statusCode?: unknown };
    // Storage bodies carry both ("code": "KeyAlreadyExists"); the numeric
    // statusCode is the one duplicate-tolerance checks against.
    const code = parsed.statusCode ?? parsed.code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True for missing-column/table/function errors — the database schema
 * predates what the call expects, so a fallback shape can retry. Matched on
 * the errcode, never the message (messages are generic for display).
 */
export function isSchemaError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^(42|PGRST)/.test(code);
}

/** The live session's access token, or null for anonymous calls. */
async function accessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken();
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn('hillgpx api error', response.status, body.slice(0, 300));
    throw new ApiError(apiErrorMessage(body, response.status), response.status, apiErrorCode(body));
  }
  return (response.status === 204 || response.status === 201 ? undefined : await response.json()) as T;
}

async function upload(bucket: string, path: string, body: Blob, contentType: string): Promise<string> {
  const token = await accessToken();
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'false',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.warn('hillgpx storage error', response.status, body.slice(0, 300));
    throw new ApiError(apiErrorMessage(body, response.status), response.status, apiErrorCode(body));
  }
  return publicUrl(bucket, path);
}

export const publicUrl = (bucket: string, path: string) => `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;

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
  const refused = refusalMessage(await moderateText(review.comment), [MODERATION_MESSAGES.comment]);
  if (refused) throw new ApiError(refused, 400);
  await rest('/rest/v1/reviews', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ id: review.id, venue_slug: review.venueSlug, rating: review.rating, comment: review.comment, author: input.author.trim().slice(0, 60) || null }),
  });
  track('review_post', review.venueSlug);
  return review;
}

/** Published ratings from the build plus live community reviews, as one figure. */
export function combinedRating(
  published: { average: number; count: number } | undefined,
  reviews: { rating: number }[],
): { average: number; count: number } | undefined {
  const publishedCount = published?.count ?? 0;
  const count = publishedCount + reviews.length;
  if (count === 0) return undefined;
  const sum = (published?.average ?? 0) * publishedCount + reviews.reduce((acc, r) => acc + r.rating, 0);
  return { average: Math.round((sum / count) * 100) / 100, count };
}

/* ─── Route reviews ────────────────────────────────────────────────────── */

export interface RouteReview {
  id: string;
  routeSlug: string;
  rating: number;
  comment: string;
  author: string;
  createdAt: string;
  editedAt: string | null;
}

export interface MyRouteReview extends RouteReview {
  hidden: boolean;
}

interface RouteReviewRow {
  id: string;
  route_slug: string;
  rating: number;
  comment: string;
  author: string | null;
  created_at: string;
  edited_at: string | null;
}

const toRouteReview = (row: RouteReviewRow): RouteReview => ({
  id: row.id,
  routeSlug: row.route_slug,
  rating: row.rating,
  comment: row.comment,
  author: row.author || 'Anonymous',
  createdAt: row.created_at,
  editedAt: row.edited_at,
});

/** Missing table (42P01, PGRST205) or function (42883, PGRST202). */
const ROUTE_REVIEWS_MISSING = new Set(['42P01', 'PGRST205', '42883', 'PGRST202']);

/** A deploy that lands before the migration says so; an outage, a refused permission or an expired session is not that. */
async function routeReviewCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ApiError && error.code && ROUTE_REVIEWS_MISSING.has(error.code)) {
      throw new ApiError('Route reviews are not available yet.', 503, error.code);
    }
    throw error;
  }
}

const reviewText = (input: { comment: string; author: string }) => ({
  comment: input.comment.trim().slice(0, 1000),
  author: input.author.trim().slice(0, 60),
});

/** Newest first. The columns are named because user_id is closed to the API: `select=*` is refused. */
export function fetchRouteReviews(routeSlug: string): Promise<RouteReview[]> {
  return routeReviewCall(async () => {
    const rows = await rest<RouteReviewRow[]>(
      `/rest/v1/route_reviews?route_slug=eq.${enc(routeSlug)}&select=id,route_slug,rating,comment,author,created_at,edited_at&order=created_at.desc&limit=200`,
    );
    return rows.map(toRouteReview);
  });
}

export async function submitRouteReview(input: { routeSlug: string; rating: number; comment: string; author: string }): Promise<RouteReview> {
  const { comment, author } = reviewText(input);
  const review: RouteReview = {
    id: id(),
    routeSlug: input.routeSlug,
    rating: input.rating,
    comment,
    author: author || 'Anonymous',
    createdAt: new Date().toISOString(),
    editedAt: null,
  };
  const refused = refusalMessage(await moderateText(comment), [MODERATION_MESSAGES.comment]);
  if (refused) throw new ApiError(refused, 400);
  return routeReviewCall(async () => {
    await rest('/rest/v1/route_reviews', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id: review.id, route_slug: review.routeSlug, rating: review.rating, comment: review.comment, author: author || null }),
    });
    track('route_review_post', review.routeSlug);
    return review;
  });
}

export async function editRouteReview(reviewId: string, input: { rating: number; comment: string; author: string }): Promise<RouteReview> {
  const { comment, author } = reviewText(input);
  const refused = refusalMessage(await moderateText(comment), [MODERATION_MESSAGES.comment]);
  if (refused) throw new ApiError(refused, 400);
  return routeReviewCall(async () => {
    const [row] = await rest<RouteReviewRow[]>('/rest/v1/rpc/edit_route_review', {
      method: 'POST',
      body: JSON.stringify({ p_id: reviewId, p_rating: input.rating, p_comment: comment, p_author: author || null }),
    });
    return toRouteReview(row);
  });
}

/** The caller's own review of a route, including one hidden from the public read. */
export function myRouteReview(routeSlug: string): Promise<MyRouteReview | null> {
  return routeReviewCall(async () => {
    const [row] = await rest<(RouteReviewRow & { status: string })[]>('/rest/v1/rpc/my_route_review', {
      method: 'POST',
      body: JSON.stringify({ p_route_slug: routeSlug }),
    });
    return row ? { ...toRouteReview(row), hidden: row.status !== 'approved' } : null;
  });
}

export function deleteRouteReview(reviewId: string): Promise<void> {
  return routeReviewCall(() => rest<void>('/rest/v1/rpc/delete_route_review', {
    method: 'POST',
    body: JSON.stringify({ p_id: reviewId }),
  }));
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
  if (!input.file.type.startsWith('image/')) throw new ApiError('That file is not an image.', 400);
  const blob = await preparePhoto(input.file);
  const refused = refusalMessage(await moderateImage(blob), [MODERATION_MESSAGES.photo]);
  if (refused) throw new ApiError(refused, 400);
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
  track('photo_upload', input.venueSlug);
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
  downloads?: number;
  status?: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

const ROUTE_FIELDS = 'slug,name,activity,recorded_at,distance_m,gain_m,loss_m,elevation_source,venue_slugs,points,gpx_path,contributor,licence,downloads,status,created_at';

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
    downloads: row.downloads ?? 0,
    // Only the uploader's own session can read a held row, so this is never someone else's.
    held: row.status === 'pending' ? true : undefined,
    rejected: row.status === 'rejected' ? true : undefined,
  };
}

export async function fetchCommunityRoutes(): Promise<Route[]> {
  try {
    const rows = await rest<RouteRow[]>(`/rest/v1/routes?select=${ROUTE_FIELDS}&order=created_at.desc&limit=1000`);
    return rows.map(toRoute);
  } catch (error) {
    // Before the accounts migration runs, routes has no downloads column —
    // degrade to the column set that has always existed rather than failing.
    if (isSchemaError(error)) {
      const rows = await rest<RouteRow[]>(`/rest/v1/routes?select=${ROUTE_FIELDS.replace(',downloads', '')}&order=created_at.desc&limit=1000`);
      return rows.map(toRoute);
    }
    throw error;
  }
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
  /** Signed-in uploaders may opt out of the public credit; ownership stays. */
  anonymous?: boolean;
  /** The quality checks' result. A key flag makes the database store the route held. */
  qualityFlags: QualityFlag[];
}

/** Store the GPX file and its row. The database rejects a second copy of the same track. */
export async function publishRoute(input: PublishRouteInput): Promise<Route> {
  const { route } = input;
  const refused = refusalMessage(await moderateText(route.name), [MODERATION_MESSAGES.routeName]);
  if (refused) throw new ApiError(refused, 400);
  // Originals are gzipped: a 50 MB ultra GPX becomes a few MB, inside the bucket limit.
  const canGzip = typeof CompressionStream !== 'undefined' && typeof Blob.prototype.stream === 'function';
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
    contributor: input.anonymous ? null : input.contributor.trim().slice(0, 60) || null,
    licence: input.licence,
    // A trigger stamps user_id from the session token and nulls the credit
    // when this flag is set (see stamp_route_owner()).
    anonymous: Boolean(input.anonymous),
    quality_flags: input.qualityFlags,
  };
  // Heart rate, cadence, power and other device extensions are personal data
  // and most of a watch file's size: the archive keeps the track, not the body.
  const original = input.originalGpx?.replace(/<extensions>[\s\S]*?<\/extensions>/g, '');
  const file = new Blob([original ?? toGpx(route.name, route.coordinates)], { type: 'application/gpx+xml' });
  const body = canGzip ? await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob() : file;
  try {
    await upload('gpx', gpxPath, body, canGzip ? 'application/gzip' : 'application/gpx+xml');
  } catch (error) {
    // A stored file with the same name is fine — a retry after a failed
    // publish always re-uploads it. Storage reports the duplicate as a body
    // statusCode "409" even when the HTTP status is 400, so check the code.
    if (!(error instanceof ApiError && (error.status === 409 || error.code === '409'))) throw error;
  }
  const insert = (payload: Record<string, unknown>) =>
    rest('/rest/v1/routes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
  try {
    await insert(row);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 409) throw new DuplicateRouteError('This track is already in the community archive.');
    // Before the accounts migration runs, routes has no anonymous column —
    // publish without it rather than failing.
    if (!isSchemaError(error)) throw error;
    // Never publish a track that failed the checks just because the column that holds it is missing.
    if (input.qualityFlags.some((f) => f.severity === 'key')) {
      throw new ApiError('Saving a route that needs review is not available yet — the latest database change is still being applied.', 503, error.code);
    }
    const fallback = { ...row } as Record<string, unknown>;
    delete fallback.anonymous;
    delete fallback.quality_flags;
    try {
      await insert(fallback);
    } catch (retryError) {
      if (retryError instanceof ApiError && retryError.status === 409) {
        throw new DuplicateRouteError('This track is already in the community archive.');
      }
      throw retryError;
    }
  }
  const held = input.qualityFlags.some((f) => f.severity === 'key');
  track('gpx_upload', row.slug);
  return toRoute({ ...row, status: held ? 'pending' : 'approved', created_at: new Date().toISOString(), contributor: row.contributor, recorded_at: row.recorded_at });
}

/* ─── Download counts ──────────────────────────────────────────────────── */

/** {slug: downloads} for every route, community and curated alike. */
export async function fetchRouteDownloads(): Promise<Record<string, number>> {
  return rest<Record<string, number>>('/rest/v1/rpc/route_downloads', { method: 'POST', body: '{}' });
}

/** Count one download. Fire-and-forget — the file matters, not the number. */
export function recordRouteDownload(slug: string): void {
  void rest(`/rest/v1/rpc/record_route_download`, { method: 'POST', body: JSON.stringify({ p_slug: slug }) }).catch(() => {});
}

/* ─── Saved items (account) ─────────────────────────────────────────────── */

export type SavedKind = 'route' | 'place';

export interface SavedItems {
  routes: string[];
  places: string[];
}

/** Everything the signed-in account has saved. Throws when the table is unavailable. */
export async function fetchSaved(): Promise<SavedItems> {
  const { data, error } = await supabase.from('saved_items').select('kind,slug').limit(2000);
  if (error) throw error;
  const rows = (data ?? []) as { kind: SavedKind; slug: string }[];
  return {
    routes: rows.filter((row) => row.kind === 'route').map((row) => row.slug),
    places: rows.filter((row) => row.kind === 'place').map((row) => row.slug),
  };
}

/** Save items for the account. Re-saving one is a no-op (the primary key dedupes). */
export async function addSaved(userId: string, kind: SavedKind, slugs: string[]): Promise<void> {
  if (slugs.length === 0) return;
  const rows = slugs.map((slug) => ({ user_id: userId, kind, slug }));
  const { error } = await supabase.from('saved_items').upsert(rows, { onConflict: 'user_id,kind,slug', ignoreDuplicates: true });
  if (error) throw error;
}

export async function removeSaved(userId: string, kind: SavedKind, slug: string): Promise<void> {
  const { error } = await supabase.from('saved_items').delete().eq('user_id', userId).eq('kind', kind).eq('slug', slug);
  if (error) throw error;
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

export type ReportKind = 'wrong_details' | 'hazard' | 'closed' | 'photo' | 'abuse' | 'other';
/** What a report is about: a place or route (by slug), or one photo, route photo, review or route review (by id). */
export type ReportTarget = 'venue' | 'route' | 'photo' | 'route_photo' | 'review' | 'route_review';

/** File a report for a maintainer to review (wrong details, hazards, closures, a bad photo). */
export async function submitReport(input: { targetType: ReportTarget; targetSlug: string; kind: ReportKind; message: string; author: string }): Promise<void> {
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
  track('report_sent', input.targetType);
}

export type ContactKind = 'question' | 'feedback' | 'removal' | 'other';

/**
 * A question, bit of feedback or removal request from the contact form. It
 * lands in the same insert-only reports queue as everything else, so the
 * moderators have one place to look; `replyTo` is the optional address for a
 * private answer.
 */
export async function submitContact(input: { kind: ContactKind; message: string; author: string; replyTo: string }): Promise<void> {
  await rest('/rest/v1/reports', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      target_type: 'site',
      target_slug: 'site',
      kind: input.kind,
      message: input.message.trim().slice(0, 1000),
      author: input.author.trim().slice(0, 60) || null,
      reply_to: input.replyTo.trim().slice(0, 160) || null,
    }),
  });
  track('contact_sent', input.kind);
}

/** A suggested place (hill, stairs, block…) from the Add a missing place form — same moderator queue as reports. */
export async function submitPlaceSuggestion(input: {
  name: string;
  type: string;
  lat: string;
  lng: string;
  gainM: string;
  summitM: string;
  source: string;
  notes: string;
  author: string;
}): Promise<void> {
  const lines = [
    `Name: ${input.name}`,
    `Type: ${input.type}`,
    `Location: ${input.lat}, ${input.lng}`,
  ];
  if (input.gainM.trim()) lines.push(`Height gain: ${input.gainM.trim()} m`);
  if (input.summitM.trim()) lines.push(`Summit elevation: ${input.summitM.trim()} m`);
  lines.push(`Source: ${input.source.trim()}`);
  if (input.notes.trim()) lines.push(`Access notes: ${input.notes.trim()}`);
  await rest('/rest/v1/reports', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      target_type: 'site',
      target_slug: 'site',
      kind: 'add_place',
      message: lines.join('\n').slice(0, 1000),
      author: input.author.trim().slice(0, 60) || null,
    }),
  });
  track('place_suggested', input.type);
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
  if (!input.file.type.startsWith('image/')) throw new ApiError('That file is not an image.', 400);
  const blob = await preparePhoto(input.file);
  const caption = input.caption.trim().slice(0, 280);
  const check = await moderate([
    { type: 'image', base64: await blobToBase64(blob) },
    ...(caption ? [{ type: 'text', text: caption } as const] : []),
  ]);
  const refused = refusalMessage(check, caption ? [MODERATION_MESSAGES.photo, MODERATION_MESSAGES.caption] : [MODERATION_MESSAGES.photo]);
  if (refused) throw new ApiError(refused, 400);
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
      caption: caption || null,
      storage_path: path,
      author: input.author.trim().slice(0, 60) || null,
    }),
  });
  track('photo_upload', input.routeSlug);
  return {
    id: photoId,
    routeSlug: input.routeSlug,
    lng: input.lng,
    lat: input.lat,
    kind: input.kind,
    caption,
    url: publicUrl('photos', path),
    author: input.author.trim() || 'You',
    createdAt: new Date().toISOString(),
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
