/**
 * Accounts: email+password sign-up or Google sign-in against the HillGPX API
 * (api/main.py `/api/auth/*`). Both issue an opaque bearer token; the session
 * lives in localStorage under `hillgpx:session` — the key is part of the
 * public contract, like the author name and favourites keys.
 *
 * Signing in is optional: contributions still work anonymously. When a visitor
 * signs in and has no saved contributor name, their username fills it.
 */
import { useSyncExternalStore } from 'react';
import { API_BASE, ApiError, apiErrorMessage, loadAuthor, saveAuthor } from './api';
import { track } from './analytics';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  providers: string[];
  avatarUrl: string | null;
  createdAt: string;
}

interface Session {
  token: string;
  user: AuthUser;
}

/** Google OAuth client ID for the rendered button; empty = Google sign-in off. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';

const SESSION_KEY = 'hillgpx:session';

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed && typeof parsed.token === 'string' && parsed.user?.username ? parsed : null;
  } catch {
    return null;
  }
}

let session: Session | null = readSession();
const listeners = new Set<() => void>();

function setSession(next: Session | null): void {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode: the session simply lasts until the tab closes.
  }
  listeners.forEach((listener) => listener());
}

let validated = false;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!validated) {
    validated = true;
    void refreshSession();
  }
  return () => listeners.delete(listener);
}

/** The signed-in user (or null), live across tabs and components. */
export function useAuthUser(): AuthUser | null {
  return useSyncExternalStore(subscribe, () => session?.user ?? null);
}

/** Confirm a stored token is still good; drop it if the API says 401. */
async function refreshSession(): Promise<void> {
  if (!session) return;
  try {
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (response.status === 401) setSession(null);
    else if (response.ok) {
      const { user } = (await response.json()) as { user: AuthUser };
      setSession({ token: session.token, user });
    }
  } catch {
    // Offline or API down: keep the session, it may still be valid.
  }
}

async function call(path: string, body: Record<string, string>): Promise<Session> {
  const response = await fetch(`${API_BASE}/api/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiError(apiErrorMessage(await response.text().catch(() => ''), response.status), response.status);
  }
  return (await response.json()) as Session;
}

function begin(next: Session): void {
  setSession(next);
  if (!loadAuthor()) saveAuthor(next.user.username);
}

export async function signUp(username: string, email: string, password: string): Promise<void> {
  begin(await call('/signup', { username, email, password }));
  track('sign_up');
}

export async function logIn(identifier: string, password: string): Promise<void> {
  begin(await call('/login', { identifier, password }));
  track('log_in');
}

export async function logInWithGoogle(credential: string): Promise<void> {
  begin(await call('/google', { credential }));
  track('log_in');
}

export async function logOut(): Promise<void> {
  const token = session?.token;
  setSession(null);
  if (token) {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
}

/* ─── Profile ────────────────────────────────────────────────────────── */

/** Merge a fresh user object into the stored session (after profile edits). */
function updateUser(user: AuthUser): void {
  if (session) setSession({ token: session.token, user });
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!session) throw new Error('Sign in first.');
  const response = await fetch(`${API_BASE}/api/auth${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${session.token}`, ...(init.headers ?? {}) },
  });
  if (response.status === 401) setSession(null);
  if (!response.ok) {
    throw new ApiError(apiErrorMessage(await response.text().catch(() => ''), response.status), response.status);
  }
  return response;
}

/** Change username and/or email; updates the stored session. */
export async function updateProfile(input: { username?: string; email?: string }): Promise<void> {
  const response = await authFetch('/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const { user } = (await response.json()) as { user: AuthUser };
  updateUser(user);
  saveAuthor(user.username);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await authFetch('/me/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

/** Replace the profile photo. `blob` is already resized by the caller. */
export async function uploadAvatar(blob: Blob): Promise<void> {
  const response = await authFetch('/me/avatar', {
    method: 'POST',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  const { user } = (await response.json()) as { user: AuthUser };
  updateUser(user);
}

export async function removeAvatar(): Promise<void> {
  const response = await authFetch('/me/avatar', { method: 'DELETE' });
  const { user } = (await response.json()) as { user: AuthUser };
  updateUser(user);
}

/** Delete the account and drop the local session. */
export async function deleteAccount(password: string): Promise<void> {
  await authFetch('/me', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: password || null }),
  });
  setSession(null);
}

/* ─── My uploads ─────────────────────────────────────────────────────── */

export interface MyUpload {
  slug: string;
  name: string;
  activity: string;
  distanceM: number;
  gainM: number;
  downloads: number;
  createdAt: string;
  gpxUrl: string;
}

interface MyUploadRow {
  slug: string;
  name: string;
  activity: string;
  distance_m: number;
  gain_m: number;
  downloads?: number;
  created_at: string;
  gpx_path: string;
}

/** Community routes the signed-in user published (stamped with their id). */
export async function fetchMyRoutes(): Promise<MyUpload[]> {
  const response = await authFetch('/me/routes');
  const rows = (await response.json()) as MyUploadRow[];
  return rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    activity: row.activity,
    distanceM: row.distance_m,
    gainM: row.gain_m,
    downloads: row.downloads ?? 0,
    createdAt: row.created_at,
    gpxUrl: `${API_BASE}/api/files/gpx/${row.gpx_path}`,
  }));
}

/** Remove a route the signed-in user published. 204 on success, 404 if not theirs. */
export async function deleteMyRoute(slug: string): Promise<void> {
  await authFetch(`/me/routes/${encodeURIComponent(slug)}`, { method: 'DELETE' });
}
