/**
 * Accounts: email+password sign-up or Google sign-in through Supabase Auth.
 * The session is kept by the supabase client (persisted in localStorage and
 * refreshed automatically); this module mirrors the signed-in user — plus
 * their public profile row — into a store components can read.
 *
 * Signing in is optional: contributions still work, credited anonymously.
 * A signed-in contributor's only credit choices are their username or
 * anonymous — the profile handle is the name every form offers.
 */
import { useSyncExternalStore } from 'react';
import type { AuthError, User } from '@supabase/supabase-js';
import { ApiError, apiErrorMessage, isSchemaError, publicUrl, supabase } from './api';
import { track } from './analytics';
import { syncSavedForUser } from './saved';
import type { RoutePoint } from '../types';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  providers: string[];
  avatarUrl: string | null;
  createdAt: string;
}

/** Google OAuth client ID for the rendered button; empty = Google sign-in off. */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';

/** Gmail addresses belong to Google sign-in. */
export function isGoogleMail(email: string): boolean {
  return /@(gmail\.com|googlemail\.com)$/i.test(email.trim());
}

/**
 * When the Google button is configured, Gmail addresses cannot use the
 * email/password paths at all — sign-up, log in, resend or reset. A reset
 * link would bolt a password onto a Google-only account, so it is refused
 * here too. Forks without VITE_GOOGLE_CLIENT_ID keep email-only sign-in for
 * every address.
 */
function requireGoogleSignIn(email: string): void {
  if (GOOGLE_CLIENT_ID && isGoogleMail(email)) {
    throw new ApiError('Gmail addresses sign in with Google — use the Google button.', 400);
  }
}

/** Signing out lands back on the home page — the wordmark's bare "#". */
function goHome(): void {
  if (typeof window === 'undefined' || window.location.hash === '') return;
  window.location.hash = '#';
}

/**
 * Where email links bring the visitor back: always the canonical site
 * (VITE_SITE_URL, set from public/CNAME at build — hillgpx.com), even when
 * the sign-up happened on a preview or the dev server. Must be allow-listed
 * under Supabase → Authentication → URL Configuration → Redirect URLs.
 */
function siteUrl(): string {
  return (import.meta.env.VITE_SITE_URL as string | undefined) || 'https://hillgpx.com';
}

interface ProfileRow {
  username: string;
  avatar_path: string | null;
}

let user: AuthUser | null = null;
const listeners = new Set<() => void>();
let started = false;
// Latest auth.users id being resolved; stale profile fetches drop out.
let resolving = 0;
// True while a password-recovery session is active. Read from the URL hash
// before supabase-js consumes it; the auth event in start() catches any
// session established after this module loaded.
let recovering = typeof window !== 'undefined' && /type=recovery/.test(window.location.hash);

function apply(next: AuthUser | null): void {
  const changed = (user?.id ?? null) !== (next?.id ?? null);
  user = next;
  if (changed) void syncSavedForUser(next?.id ?? null);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

function start(): void {
  if (started) return;
  started = true;
  void supabase.auth.getSession().then(({ data }) => syncUser(data.session?.user ?? null));
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && !recovering) {
      recovering = true;
      listeners.forEach((listener) => listener());
    }
    void syncUser(session?.user ?? null);
  });
}

/** The signed-in user (or null), live across tabs and components. */
export function useAuthUser(): AuthUser | null {
  return useSyncExternalStore(subscribe, () => user);
}

/** True while a reset-password session is live — the site shows the new-password dialog. */
export function usePasswordRecovery(): boolean {
  return useSyncExternalStore(subscribe, () => recovering);
}

/** Dismiss the new-password dialog (the recovery session itself stays live). */
export function clearPasswordRecovery(): void {
  recovering = false;
  listeners.forEach((listener) => listener());
}

/** Fold an auth user plus their public profile into the app's user shape. */
async function toAuthUser(account: User): Promise<AuthUser> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('username,avatar_path')
    .eq('id', account.id)
    .maybeSingle<ProfileRow>();
  const meta = account.user_metadata as { username?: string } | undefined;
  return {
    id: account.id,
    username: profile?.username ?? meta?.username ?? account.email?.split('@')[0] ?? 'climber',
    email: account.email ?? '',
    providers:
      (account.app_metadata.providers as string[] | undefined) ??
      account.identities?.map((identity) => identity.provider).filter((p): p is string => Boolean(p)) ??
      [],
    avatarUrl: profile?.avatar_path ? publicUrl('avatars', profile.avatar_path) : null,
    createdAt: account.created_at,
  };
}

async function syncUser(account: User | null): Promise<void> {
  const ticket = ++resolving;
  if (!account) {
    apply(null);
    return;
  }
  try {
    const next = await toAuthUser(account);
    if (ticket === resolving) apply(next);
  } catch {
    // Profile table unreachable: still surface the account.
    if (ticket === resolving) {
      apply({
        id: account.id,
        username: account.email?.split('@')[0] ?? 'climber',
        email: account.email ?? '',
        providers: [],
        avatarUrl: null,
        createdAt: account.created_at,
      });
    }
  }
}

/** Turn a Supabase Auth error into the sentence the form should show. */
function authError(error: AuthError): ApiError {
  const code = error.code ?? '';
  if (code === 'invalid_credentials' || /invalid login/i.test(error.message)) {
    return new ApiError('Wrong email or password.', 401);
  }
  if (code === 'user_already_exists' || /already registered/i.test(error.message)) {
    return new ApiError('That email is already registered.', 409);
  }
  if (code === 'email_not_confirmed') {
    return new ApiError('Confirm your email address first, then sign in.', 403);
  }
  if (/database error saving new user/i.test(error.message)) {
    return new ApiError('Could not create the account — that username may be taken. Try another.', 409);
  }
  if (/password/i.test(error.message) && /(weak|short|least)/i.test(error.message)) {
    return new ApiError('Passwords need at least 8 characters.', 400);
  }
  if (code.startsWith('over_') || /rate limit|too many requests/i.test(error.message)) {
    return new ApiError('Too many emails sent — Supabase pauses them for a while. Try again in about an hour.', 429);
  }
  return new ApiError('Something went wrong — please try again.', error.status ?? 500);
}

/** PostgREST errors from profiles/rpc calls carry the message in .message. */
function dbError(error: { message: string; code?: string }): ApiError {
  if (error.code === '23505' || /duplicate key/i.test(error.message)) {
    return new ApiError('That username is taken.', 409);
  }
  if (isSchemaError(error)) {
    return new ApiError('Account features are temporarily unavailable. Please try again later.', 503, error.code);
  }
  // Pass the errcode through so deliberate P0001 sentences reach the form.
  return new ApiError(apiErrorMessage(JSON.stringify({ message: error.message, code: error.code }), 400), 400, error.code);
}

/**
 * Returns true when the account still needs email confirmation (no session
 * yet — the modal shows a "check your inbox" screen); false when it signed
 * in straight away.
 */
export async function signUp(username: string, email: string, password: string): Promise<boolean> {
  requireGoogleSignIn(email);
  username = username.trim();
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) {
    throw new ApiError('Usernames are 3–24 letters, numbers, dots, dashes or underscores.', 400);
  }
  // A friendly check before the database's unique index says the same thing.
  // (ilike wildcards make _ and % match anything — compare the hit properly.)
  const { data: hits } = await supabase.from('profiles').select('username').ilike('username', username).limit(1);
  if (hits?.some((hit) => hit.username.toLowerCase() === username.toLowerCase())) {
    throw new ApiError('That username is taken.', 409);
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username }, emailRedirectTo: siteUrl() },
  });
  if (error) throw authError(error);
  if (!data.session) return true;
  await syncUser(data.session.user);
  track('sign_up');
  return false;
}

/** Validate the supplied email locally; never resolve a public username to
 *  an account email through a database RPC. */
function accountEmail(value: string): string {
  const email = value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError('Enter your email address.', 400);
  }
  return email;
}

/** Resend confirmation to the supplied email through Supabase Auth. */
export async function resendConfirmation(email: string): Promise<void> {
  requireGoogleSignIn(email);
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: accountEmail(email),
    options: { emailRedirectTo: siteUrl() },
  });
  if (error) throw authError(error);
}

/** Send a password-reset link without exposing whether the email exists. */
export async function resetPasswordForEmail(email: string): Promise<void> {
  requireGoogleSignIn(email);
  const { error } = await supabase.auth.resetPasswordForEmail(accountEmail(email), { redirectTo: siteUrl() });
  if (error) throw authError(error);
}

/** Set the new password inside the recovery session the reset link opened. */
export async function finishPasswordReset(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw authError(error);
  recovering = false;
  listeners.forEach((listener) => listener());
  track('password_reset');
}

export async function logIn(email: string, password: string): Promise<void> {
  requireGoogleSignIn(email);
  const { data, error } = await supabase.auth.signInWithPassword({ email: accountEmail(email), password });
  if (error) throw authError(error);
  await syncUser(data.session.user);
  track('log_in');
}

export async function logInWithGoogle(credential: string): Promise<void> {
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: credential });
  if (error) throw authError(error);
  if (!data.session) throw new ApiError('Google sign-in did not complete — try again.', 401);
  await syncUser(data.session.user);
  track('log_in');
}

export async function logOut(): Promise<void> {
  apply(null);
  goHome();
  await supabase.auth.signOut().catch(() => {});
}

/* ─── Profile ────────────────────────────────────────────────────────── */

function requireUser(): AuthUser {
  if (!user) throw new ApiError('Sign in first.', 401);
  return user;
}

async function refreshUser(): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (data.user) await syncUser(data.user);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const current = requireUser();
  if (!current.providers.includes('email')) {
    throw new ApiError('This account uses Google sign-in — there is no password to change.', 400);
  }
  // Supabase has no "verify current password" call; signing back in with it
  // is the check, and the returned session simply replaces the current one.
  const { error } = await supabase.auth.signInWithPassword({ email: current.email, password: currentPassword });
  if (error) throw new ApiError('That is not your current password.', 401);
  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
  if (updateError) throw authError(updateError);
  // Sign out everywhere else; this session stays valid.
  await supabase.auth.signOut({ scope: 'others' }).catch(() => {});
}

/** Replace the profile photo. `blob` is already resized by the caller. */
export async function uploadAvatar(blob: Blob): Promise<void> {
  const current = requireUser();
  const path = `${current.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw dbError(error);
  const old = current.avatarUrl?.startsWith(publicUrl('avatars', '')) ? current.avatarUrl.slice(publicUrl('avatars', '').length) : null;
  if (old) await supabase.storage.from('avatars').remove([old]).catch(() => undefined);
  const { error: updateError } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', current.id);
  if (updateError) throw dbError(updateError);
  await refreshUser();
}

export async function removeAvatar(): Promise<void> {
  const current = requireUser();
  const old = current.avatarUrl?.startsWith(publicUrl('avatars', '')) ? current.avatarUrl.slice(publicUrl('avatars', '').length) : null;
  if (old) await supabase.storage.from('avatars').remove([old]).catch(() => undefined);
  const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', current.id);
  if (error) throw dbError(error);
  await refreshUser();
}

/**
 * Rename the public handle. The unique index on lower(username) and the
 * column's format check are the real guards — the lookup just says it
 * first. The sync_credit_name trigger rewrites the credit on every
 * contribution the owner published under the old name — routes, reviews,
 * photos, route photos and reports alike. Needs the editable-username
 * migration's column grant.
 */
export async function changeUsername(next: string): Promise<void> {
  const current = requireUser();
  const username = next.trim();
  if (!/^[A-Za-z0-9_.-]{3,24}$/.test(username)) {
    throw new ApiError('Usernames are 3–24 letters, numbers, dots, dashes or underscores.', 400);
  }
  if (username === current.username) return;
  // As at sign-up, ilike's wildcards only narrow the list; the lower() match
  // below is the real comparison, and the owner's own row is not a clash.
  const { data: hits } = await supabase.from('profiles').select('id,username').ilike('username', username).limit(10);
  if (hits?.some((hit) => hit.id !== current.id && hit.username.toLowerCase() === username.toLowerCase())) {
    throw new ApiError('That username is taken.', 409);
  }
  const { error } = await supabase.from('profiles').update({ username }).eq('id', current.id);
  if (error) throw dbError(error);
  // Keep the auth-metadata fallback (a missing profile row) in step.
  await supabase.auth.updateUser({ data: { username } }).catch(() => undefined);
  await refreshUser();
  track('username_change');
}

/**
 * Delete the account and drop the local session. Goes back to the landing page
 * unless `stay` is set, which the settings dialog uses to show its own
 * "account deleted" confirmation first.
 */
export async function deleteAccount(password: string, options: { stay?: boolean } = {}): Promise<void> {
  const current = requireUser();
  // Password accounts confirm with their password; Google-only accounts have
  // nothing to check against and delete straight away.
  if (current.providers.includes('email')) {
    const { error } = await supabase.auth.signInWithPassword({ email: current.email, password });
    if (error) throw new ApiError('Enter your password to delete the account.', 401);
  }
  const { error } = await supabase.rpc('delete_user');
  if (error) throw dbError(error);
  apply(null);
  if (!options.stay) goHome();
  await supabase.auth.signOut().catch(() => {});
}

/* ─── My uploads ─────────────────────────────────────────────────────── */

export interface MyUpload {
  slug: string;
  name: string;
  activity: string;
  distanceM: number;
  gainM: number;
  downloads: number;
  anonymous: boolean;
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
  anonymous?: boolean;
  created_at: string;
  gpx_path: string;
}

/** Community routes the signed-in user published (stamped with their id). */
export async function fetchMyRoutes(): Promise<MyUpload[]> {
  const current = requireUser();
  const fields = 'slug,name,activity,distance_m,gain_m,downloads,anonymous,created_at,gpx_path';
  const query = (columns: string) =>
    supabase
      .from('routes')
      .select(columns)
      .eq('user_id', current.id)
      .order('created_at', { ascending: false })
      .limit(500);
  let { data, error } = await query(fields);
  // Before the accounts migration adds routes.downloads/anonymous — fetch
  // without them (user_id itself must exist; without it there are no owners).
  if (error && isSchemaError(error)) {
    ({ data, error } = await query(fields.replace(',downloads', '').replace(',anonymous', '')));
  }
  if (error) throw dbError(error);
  // The column list is a variable (the fallback drops downloads), so the
  // row type comes from the cast, not postgrest-js's literal parsing.
  return ((data ?? []) as unknown as MyUploadRow[]).map((row) => ({
    slug: row.slug,
    name: row.name,
    activity: row.activity,
    distanceM: row.distance_m,
    gainM: row.gain_m,
    downloads: row.downloads ?? 0,
    anonymous: row.anonymous ?? false,
    createdAt: row.created_at,
    gpxUrl: publicUrl('gpx', row.gpx_path),
  }));
}

/** Remove a route the signed-in user published, with its files and counts. */
export async function deleteMyRoute(slug: string): Promise<void> {
  const current = requireUser();
  const call = () => supabase.rpc('delete_community_route', { p_slug: slug });
  let { error } = await call();
  if (error && /^PGRST3/.test(error.code ?? '')) {
    // The access token died while the dialog was open (a refresh that lost
    // its race, or a revoked session). Force one refresh, then retry.
    await supabase.auth.refreshSession().catch(() => undefined);
    if (!user) {
      throw new ApiError('Your sign-in has expired — sign in again, then try deleting the route.', 401);
    }
    ({ error } = await call());
    if (error && /^PGRST3/.test(error.code ?? '')) {
      throw new ApiError('Your sign-in has expired — sign in again, then try deleting the route.', 401);
    }
  }
  if (error && isSchemaError(error)) {
    // A partially applied migration can leave the RPC missing or denied
    // (PGRST202/42501). The "delete own routes" policy makes the same
    // ownership check server-side, so deleting the row directly is no less
    // safe — it just cannot reach the stored GPX, thumbs and counters.
    console.warn('hillgpx delete RPC unavailable, deleting row directly', error.code, error.message);
    const { data, error: rowError } = await supabase
      .from('routes')
      .delete()
      .eq('slug', slug)
      .eq('user_id', current.id)
      .select('slug');
    if (rowError) throw dbError(rowError);
    if (data && data.length > 0) return;
    throw new ApiError('No such route on your account.', 404);
  }
  if (error) throw dbError(error);
}

/** A replacement track from a post-publish trim: the kept slice and its stats. */
export interface RouteTrackEdit {
  points: RoutePoint[];
  distanceM: number;
  gainM: number;
  lossM: number;
  venueSlugs: string[];
  fingerprint: string;
  /** Serialised GPX for the kept slice — the stored file is replaced with it. */
  gpxText: string;
}

/**
 * Rename, re-credit or re-trim a route the signed-in user published. Only the
 * fields passed change; the slug — and so every link and bookmark — stays.
 * A trim also swaps the stored GPX: the regenerated file goes up under a
 * fresh name first, then the RPC points the row at it and deletes the old
 * object, so the cut-off ends leave the archive too. Returns the new file's
 * storage path when the track was replaced.
 */
export async function editMyRoute(
  slug: string,
  edit: { name?: string; anonymous?: boolean; track?: RouteTrackEdit },
): Promise<{ gpxPath: string | null }> {
  requireUser();
  let gpxPath: string | null = null;
  if (edit.track) {
    const canGzip = typeof CompressionStream !== 'undefined' && typeof Blob.prototype.stream === 'function';
    gpxPath = `${slug}-e${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}.gpx${canGzip ? '.gz' : ''}`;
    const file = new Blob([edit.track.gpxText], { type: 'application/gpx+xml' });
    const body = canGzip ? await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob() : file;
    const { error: uploadError } = await supabase.storage
      .from('gpx')
      .upload(gpxPath, body, { contentType: canGzip ? 'application/gzip' : 'application/gpx+xml' });
    if (uploadError) throw dbError(uploadError);
  }
  const params = {
    p_slug: slug,
    p_name: edit.name?.trim() ?? null,
    p_anonymous: edit.anonymous ?? null,
    p_points: edit.track?.points ?? null,
    p_distance_m: edit.track?.distanceM ?? null,
    p_gain_m: edit.track?.gainM ?? null,
    p_loss_m: edit.track?.lossM ?? null,
    p_geom_hash: edit.track?.fingerprint ?? null,
    p_venue_slugs: edit.track?.venueSlugs ?? null,
    p_gpx_path: gpxPath,
  };
  const call = () => supabase.rpc('edit_community_route', params);
  let { error } = await call();
  if (error && /^PGRST3/.test(error.code ?? '')) {
    // The access token died while the panel was open — refresh once, then retry.
    await supabase.auth.refreshSession().catch(() => undefined);
    if (!user) {
      throw new ApiError('Your sign-in has expired — sign in again, then try saving the route.', 401);
    }
    ({ error } = await call());
    if (error && /^PGRST3/.test(error.code ?? '')) {
      throw new ApiError('Your sign-in has expired — sign in again, then try saving the route.', 401);
    }
  }
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      // geom_hash is unique: the kept slice duplicates a route already up.
      throw new ApiError('That trimmed track is already in the community archive.', 409);
    }
    if (isSchemaError(error)) {
      throw new ApiError('Route editing is not available yet — the latest database change is still being applied.', 503, error.code);
    }
    throw dbError(error);
  }
  track('route_edit', slug);
  return { gpxPath };
}
