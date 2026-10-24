import { ApiError } from './api';
import { GOOGLE_CLIENT_ID } from './auth';
import { loadGis, type RevocationResponse, type TokenResponse } from './gis';
import { track } from './analytics';
import type { RouteActivity } from '../types';

/**
 * Google Health linking (Fitbit, Pixel Watch, and anything else syncing into
 * a Google account), done entirely in the browser: the same OAuth client
 * that renders Google sign-in (VITE_GOOGLE_CLIENT_ID) drives the GIS token
 * client, consent happens in a popup, and the browser calls
 * health.googleapis.com with the short-lived access token it gets back.
 *
 * Nothing reaches a server — no client secret, no stored refresh token, no
 * edge function. A granted scope silently re-issues tokens until the user
 * revokes access in their Google account; `hillgpx:ghealth` remembers that
 * a grant exists so the import dialog can offer the workout list straight
 * away.
 */

const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.location.readonly',
].join(' ');
const LOCATION_SCOPE = 'googlehealth.location.readonly';
const HEALTH = 'https://health.googleapis.com/v4';
const LINKED_KEY = 'hillgpx:ghealth';

/** The live access token, kept in memory only — never persisted. */
let token: { value: string; scopes: string; expiresAt: number } | null = null;

export interface GoogleHealthStatus {
  connected: boolean;
  /** True when the user granted workouts AND location: GPS exports need both. */
  hasLocation: boolean;
  connectedAt: string | null;
}

export interface GoogleWorkout {
  id: string;
  name: string;
  /** Google's exerciseType enum, e.g. RUNNING / HIKING / BIKING. */
  type: string;
  startTime: string;
  endTime: string;
  distanceM: number | null;
  hasGps: boolean;
}

function markLinked(): void {
  try {
    localStorage.setItem(LINKED_KEY, new Date().toISOString());
  } catch {
    // Private mode: linking still works for this tab's lifetime.
  }
}

function linkedAt(): string | null {
  try {
    return localStorage.getItem(LINKED_KEY);
  } catch {
    return null;
  }
}

function clearLinked(): void {
  try {
    localStorage.removeItem(LINKED_KEY);
  } catch {
    // Same story as markLinked.
  }
}

function granted(scope: string): boolean {
  return Boolean(token?.scopes.split(' ').some((s) => s.endsWith(scope)));
}

function consentError(response: TokenResponse): ApiError {
  if (response.error === 'access_denied') {
    return new ApiError('Google did not grant access — allow the permissions to pull your workouts.', 403, 'access_denied');
  }
  return new ApiError('The Google consent did not finish — try again.', 403, response.error);
}

/** Drive the token client once: 'consent' shows the popup, '' stays silent. */
async function requestToken(prompt: '' | 'consent'): Promise<TokenResponse> {
  if (!GOOGLE_CLIENT_ID) throw new ApiError('Google sign-in is not configured on this site.', 503, 'unconfigured');
  const google = await loadGis().catch(() => {
    throw new ApiError('Google did not load — check your connection and try again.', 503);
  });
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPES,
      callback: (response) => (response.error ? reject(consentError(response)) : resolve(response)),
      error_callback: (error) =>
        reject(
          new ApiError(
            error?.type === 'popup_closed'
              ? 'The Google popup was closed before finishing.'
              : error?.type === 'opt_out_or_no_session'
                ? 'Google could not reach your account — allow third-party cookies for accounts.google.com and try again.'
                : 'The Google popup did not open — allow popups and try again.',
            400,
            error?.type,
          ),
        ),
    });
    try {
      client.requestAccessToken({ prompt });
    } catch {
      // A synchronous throw would otherwise leave the promise unsettled and
      // the dialog stuck on "Checking the connection…" forever.
      reject(new ApiError('The Google popup did not open — allow popups and try again.', 400, 'popup_failed_to_open'));
    }
  });
}

function storeToken(response: TokenResponse): string {
  const value = response.access_token;
  if (!value) throw new ApiError('Google did not return a token.', 502);
  token = { value, scopes: response.scope ?? '', expiresAt: Date.now() + (Number(response.expires_in ?? 3600) - 60) * 1000 };
  // A silent or consenting success both prove a grant exists.
  markLinked();
  return value;
}

/** A live token, silently re-issued when expired or after a page reload. */
async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now()) return token.value;
  return storeToken(await requestToken(''));
}

/** Turn a failed health.googleapis.com response into the sentence to show. */
function healthError(status: number, body: string): ApiError {
  if (body.includes('ACCOUNT_NOT_LINKED')) {
    return new ApiError('That Google account is not linked to Google Health yet — finish setup at fitbit.google.com, then try again.', 400, 'unlinked');
  }
  if (status === 403 && body.includes('location')) {
    return new ApiError('Google refused the GPS export — unlink and reconnect, allowing location access.', 403, 'location_scope');
  }
  return new ApiError(`Google Health did not answer (HTTP ${status}).`, 502);
}

/**
 * Revoke the whole grant at Google and wait for the answer. revoke() only
 * accepts a valid access token; an already-dead grant answers invalid_token,
 * which Google says counts as revoked.
 */
async function revokeGrant(value: string): Promise<void> {
  const google = await loadGis().catch(() => {
    throw new ApiError('Google did not load — check your connection and try again.', 503);
  });
  const result = await new Promise<RevocationResponse>((resolve) => {
    const timer = setTimeout(() => resolve({}), 8000);
    try {
      google.accounts.oauth2.revoke(value, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
    } catch {
      clearTimeout(timer);
      resolve({ successful: false, error: 'invalid_request' });
    }
  });
  if (result.error && result.error !== 'invalid_token') {
    throw new ApiError('Google could not unlink right now — try again, or remove hillGPX under your Google account permissions.', 502, result.error);
  }
}

/** Consent popup → access token. Resolves connected; throws an ApiError. */
export async function connectGoogleHealth(): Promise<void> {
  // Drop any token this session still holds so a grant a failed unlink left
  // behind cannot carry into the new consent. Fire-and-forget: awaiting a
  // token request first would spend the click's user gesture and Google
  // would refuse to open the consent popup.
  const stale = token?.value;
  token = null;
  if (stale) void revokeGrant(stale).catch(() => {});
  storeToken(await requestToken('consent'));
  track('ghealth_connect');
}

/** Whether the silent path can mint a token: consent exists and is usable. */
export async function googleHealthStatus(): Promise<GoogleHealthStatus> {
  // Warm the GIS script while the dialog is open so a Link click reaches
  // requestAccessToken inside the user gesture — a cold script load spends
  // it and the consent popup gets blocked.
  if (GOOGLE_CLIENT_ID) void loadGis().catch(() => {});
  const at = linkedAt();
  if (!at && !token) return { connected: false, hasLocation: false, connectedAt: null };
  try {
    await accessToken();
    return { connected: true, hasLocation: granted(LOCATION_SCOPE), connectedAt: at };
  } catch {
    return { connected: false, hasLocation: false, connectedAt: null };
  }
}

/** Revoke at Google and forget the link locally. */
export async function disconnectGoogleHealth(): Promise<void> {
  // revoke() needs a valid access token: reuse the live one, or let the
  // silent path mint a fresh one while a grant still stands. When no token
  // can be issued the grant is already gone — just clear the local flag.
  const value = await accessToken().catch(() => null);
  if (value) await revokeGrant(value);
  token = null;
  clearLinked();
}

interface DataPoint {
  name?: string;
  exercise?: {
    interval?: { startTime?: string; endTime?: string };
    exerciseType?: string;
    displayName?: string;
    metricsSummary?: { distanceMillimeters?: number };
    exerciseMetadata?: { hasGps?: boolean };
  };
}

const toWorkout = (point: DataPoint): GoogleWorkout | null => {
  const exercise = point.exercise;
  const id = point.name?.split('/').pop();
  if (!exercise || !id || !exercise.interval?.startTime) return null;
  const distanceMm = exercise.metricsSummary?.distanceMillimeters;
  return {
    id,
    name: exercise.displayName?.trim() || exercise.exerciseType?.replace(/_/g, ' ').toLowerCase() || 'Workout',
    type: exercise.exerciseType ?? '',
    startTime: exercise.interval.startTime,
    endTime: exercise.interval.endTime ?? exercise.interval.startTime,
    distanceM: typeof distanceMm === 'number' ? distanceMm / 1000 : null,
    hasGps: Boolean(exercise.exerciseMetadata?.hasGps),
  };
};

/** The reason fetch() itself rejected — kept for the error message so a
 *  blocked request (extension, DNS, offline) is diagnosable. */
function fetchReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'unknown error';
}

interface HttpResult {
  ok: boolean;
  status: number;
  body: string;
}

/** GET over XMLHttpRequest — fetch() patches in blockers usually leave it alone. */
function xhrGet(url: string, headers: Record<string, string>): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body: xhr.responseText });
    xhr.onerror = () => reject(new TypeError('Network request failed'));
    xhr.onabort = () => reject(new TypeError('Network request aborted'));
    xhr.send();
  });
}

/** GET a Google Health endpoint: fetch first, XHR once, same-origin relay last. */
async function healthGet(url: string, proxyPath: string, accept?: string): Promise<HttpResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}` };
  if (accept) headers.Accept = accept;
  try {
    const response = await fetch(url, { headers });
    return { ok: response.ok, status: response.status, body: await response.text() };
  } catch (directError) {
    // A fetch() rejection is network-level — offline, or an extension that
    // hooked window.fetch. XHR rides a different code path, so try it once.
    try {
      return await xhrGet(url, headers);
    } catch {
      // Last resort on Google-blocked networks: the Cloudflare Pages relay at
      // /api/ghealth forwards the request server-side. On hosts without
      // functions (vite dev, the GitHub Pages backup) the marker header is
      // missing — that is just "unreachable", not an answer.
      const relayed = await fetch(proxyPath, { headers }).catch(() => null);
      if (relayed?.headers.get('x-ghealth-proxy')) {
        return { ok: relayed.ok, status: relayed.status, body: await relayed.text() };
      }
      throw new ApiError(`Could not reach Google Health — ${fetchReason(directError)}.`, 502);
    }
  }
}

/** Every exercise session Google Health knows about (one page, 50 max). */
export async function listGoogleWorkouts(): Promise<GoogleWorkout[]> {
  const result = await healthGet(`${HEALTH}/users/me/dataTypes/exercise/dataPoints?page_size=50`, '/api/ghealth?kind=workouts', 'application/json');
  if (!result.ok) throw healthError(result.status, result.body);
  const data = JSON.parse(result.body) as { dataPoints?: DataPoint[] };
  return (data.dataPoints ?? []).map(toWorkout).filter((w): w is GoogleWorkout => Boolean(w));
}

/** The workout's GPS route as TCX text (Google's own export). Needs BOTH the
 *  activity and location scopes — a partial grant lists workouts but every
 *  export fails, so callers check hasLocation first. */
export async function fetchWorkoutTcx(id: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ApiError('Unknown workout id.', 400);
  const result = await healthGet(`${HEALTH}/users/me/dataTypes/exercise/dataPoints/${id}:exportExerciseTcx?alt=media`, `/api/ghealth?kind=tcx&id=${encodeURIComponent(id)}`);
  if (!result.ok) throw healthError(result.status, result.body);
  return result.body;
}

/** Google's exerciseType → our icon set; unknowns draw as a trail glyph. */
export function workoutActivity(type: string): RouteActivity {
  if (/RUN|JOG/i.test(type)) return 'run';
  if (/WALK|HIK|STAIR|TREADMILL/i.test(type)) return 'trail';
  if (/BIK|CYC/i.test(type)) return 'cycle';
  return 'trail';
}
