import { ApiError } from './api';
import { GOOGLE_CLIENT_ID } from './auth';
import { loadGis, type TokenResponse } from './gis';
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
            error?.type === 'popup_closed' ? 'The Google popup was closed before finishing.' : 'The Google popup did not open — allow popups and try again.',
            400,
            error?.type,
          ),
        ),
    });
    client.requestAccessToken({ prompt });
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
async function healthError(response: Response): Promise<ApiError> {
  const body = await response.text().catch(() => '');
  if (body.includes('ACCOUNT_NOT_LINKED')) {
    return new ApiError('That Google account is not linked to Google Health yet — finish setup at fitbit.google.com, then try again.', 400, 'unlinked');
  }
  if (response.status === 403 && body.includes('location')) {
    return new ApiError('Google refused the GPS export — unlink and reconnect, allowing location access.', 403, 'location_scope');
  }
  return new ApiError(`Google Health did not answer (HTTP ${response.status}).`, 502);
}

/** Consent popup → access token. Resolves connected; throws an ApiError. */
export async function connectGoogleHealth(): Promise<void> {
  storeToken(await requestToken('consent'));
  track('ghealth_connect');
}

/** Whether the silent path can mint a token: consent exists and is usable. */
export async function googleHealthStatus(): Promise<GoogleHealthStatus> {
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
  const value = token?.value;
  token = null;
  clearLinked();
  if (value) {
    const google = await loadGis().catch(() => null);
    google?.accounts.oauth2.revoke(value);
  }
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

/** Every exercise session Google Health knows about (one page, 50 max). */
export async function listGoogleWorkouts(): Promise<GoogleWorkout[]> {
  const response = await fetch(`${HEALTH}/users/me/dataTypes/exercise/dataPoints?page_size=50`, {
    headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'application/json' },
  });
  if (!response.ok) throw await healthError(response);
  const data = (await response.json()) as { dataPoints?: DataPoint[] };
  return (data.dataPoints ?? []).map(toWorkout).filter((w): w is GoogleWorkout => Boolean(w));
}

/** The workout's GPS route as TCX text (Google's own export). */
export async function fetchWorkoutTcx(id: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new ApiError('Unknown workout id.', 400);
  const response = await fetch(`${HEALTH}/users/me/dataTypes/exercise/dataPoints/${id}:exportExerciseTcx?alt=media`, {
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (!response.ok) throw await healthError(response);
  return response.text();
}

/** Google's exerciseType → our icon set; unknowns draw as a trail glyph. */
export function workoutActivity(type: string): RouteActivity {
  if (/RUN|JOG/i.test(type)) return 'run';
  if (/WALK|HIK|STAIR|TREADMILL/i.test(type)) return 'trail';
  if (/BIK|CYC/i.test(type)) return 'cycle';
  return 'trail';
}
