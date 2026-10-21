/**
 * Accounts: email+password sign-up or Google sign-in through Supabase Auth.
 * The session is kept by the supabase client (persisted in localStorage and
 * refreshed automatically); this module mirrors the signed-in user — plus
 * their public profile row — into a store components can read.
 *
 * Signing in is optional: contributions still work anonymously. When a
 * visitor signs in and has no saved contributor name, their username fills
 * it.
 */
import { useSyncExternalStore } from 'react';
import type { AuthError, User } from '@supabase/supabase-js';
import { ApiError, apiErrorMessage, loadAuthor, publicUrl, saveAuthor, supabase } from './api';
import { track } from './analytics';

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

interface ProfileRow {
  username: string;
  avatar_path: string | null;
}

let user: AuthUser | null = null;
const listeners = new Set<() => void>();
let started = false;
// Latest auth.users id being resolved; stale profile fetches drop out.
let resolving = 0;

function apply(next: AuthUser | null): void {
  user = next;
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
  supabase.auth.onAuthStateChange((_event, session) => void syncUser(session?.user ?? null));
}

/** The signed-in user (or null), live across tabs and components. */
export function useAuthUser(): AuthUser | null {
  return useSyncExternalStore(subscribe, () => user);
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
    return new ApiError('Wrong email, username or password.', 401);
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
  return new ApiError(error.message, error.status ?? 500);
}

/** PostgREST errors from profiles/rpc calls carry the message in .message. */
function dbError(error: { message: string; code?: string }): ApiError {
  if (error.code === '23505' || /duplicate key/i.test(error.message)) {
    return new ApiError('That username is taken.', 409);
  }
  return new ApiError(apiErrorMessage(JSON.stringify({ message: error.message }), 400), 400);
}

/** After any sign-in, an empty contributor name inherits the username. */
function fillAuthor(): void {
  if (user && !loadAuthor()) saveAuthor(user.username);
}

export async function signUp(username: string, email: string, password: string): Promise<void> {
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
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
  if (error) throw authError(error);
  if (!data.session) throw new ApiError('Account created — confirm the email we just sent, then sign in.', 200);
  await syncUser(data.session.user);
  fillAuthor();
  track('sign_up');
}

export async function logIn(identifier: string, password: string): Promise<void> {
  let email = identifier.trim();
  if (!email.includes('@')) {
    const { data, error } = await supabase.rpc('email_for_username', { p_username: email });
    if (error || !data) throw new ApiError('Wrong email, username or password.', 401);
    email = data as string;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw authError(error);
  await syncUser(data.session.user);
  fillAuthor();
  track('log_in');
}

export async function logInWithGoogle(credential: string): Promise<void> {
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: credential });
  if (error) throw authError(error);
  if (!data.session) throw new ApiError('Google sign-in did not complete — try again.', 401);
  await syncUser(data.session.user);
  fillAuthor();
  track('log_in');
}

export async function logOut(): Promise<void> {
  apply(null);
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

/** Change username and/or email; updates the stored user. */
export async function updateProfile(input: { username?: string; email?: string }): Promise<void> {
  const current = requireUser();
  if (input.username && input.username !== current.username) {
    const username = input.username.trim();
    const { error } = await supabase.from('profiles').update({ username }).eq('id', current.id);
    if (error) throw dbError(error);
  }
  if (input.email && input.email !== current.email) {
    const { error } = await supabase.auth.updateUser({ email: input.email.trim() });
    if (error) throw authError(error);
  }
  await refreshUser();
  if (user) saveAuthor(user.username);
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

/** Delete the account and drop the local session. */
export async function deleteAccount(password: string): Promise<void> {
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
  const current = requireUser();
  const { data, error } = await supabase
    .from('routes')
    .select('slug,name,activity,distance_m,gain_m,downloads,created_at,gpx_path')
    .eq('user_id', current.id)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw dbError(error);
  return ((data ?? []) as MyUploadRow[]).map((row) => ({
    slug: row.slug,
    name: row.name,
    activity: row.activity,
    distanceM: row.distance_m,
    gainM: row.gain_m,
    downloads: row.downloads ?? 0,
    createdAt: row.created_at,
    gpxUrl: publicUrl('gpx', row.gpx_path),
  }));
}

/** Remove a route the signed-in user published, with its files and counts. */
export async function deleteMyRoute(slug: string): Promise<void> {
  const { error } = await supabase.rpc('delete_community_route', { p_slug: slug });
  if (error) throw dbError(error);
}
