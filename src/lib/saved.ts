import { useSyncExternalStore } from 'react';
import { addSaved, fetchSaved, removeSaved, type SavedKind } from './api';
import { track } from './analytics';
import { loadFavorites, loadRouteBookmarks, saveFavorites, saveRouteBookmarks } from './venues';

/**
 * Saved routes and places, one snapshot shared by every heart and count.
 *
 * Signed in, they belong to the account (`saved_items`) and follow it across
 * devices. Signed out, they stay in this browser through the helpers in
 * `venues.ts`, as before. The first time someone signs in, what this browser
 * holds is merged into the account (deduplicated by the table's primary key)
 * and the local copy is cleared. If the account table cannot be reached the
 * store stays on the local copy and nothing is cleared, so a save is never lost.
 */
interface State {
  routes: Set<string>;
  places: Set<string>;
  /** Set while an account is loaded and the table answered. */
  userId: string | null;
}

let state: State = { routes: loadRouteBookmarks(), places: loadFavorites(), userId: null };
const listeners = new Set<() => void>();
// Latest sign-in being resolved; a slow fetch for a stale session drops out.
let ticket = 0;

function set(next: State): void {
  state = next;
  for (const listener of listeners) listener();
}

/** Called by auth when the signed-in user changes (null = signed out). */
export async function syncSavedForUser(userId: string | null): Promise<void> {
  const mine = ++ticket;
  if (!userId) {
    set({ routes: loadRouteBookmarks(), places: loadFavorites(), userId: null });
    return;
  }
  try {
    const remote = await fetchSaved();
    if (mine !== ticket) return;
    const localRoutes = loadRouteBookmarks();
    const localPlaces = loadFavorites();
    const missingRoutes = [...localRoutes].filter((slug) => !remote.routes.includes(slug));
    const missingPlaces = [...localPlaces].filter((slug) => !remote.places.includes(slug));
    await addSaved(userId, 'route', missingRoutes);
    await addSaved(userId, 'place', missingPlaces);
    if (mine !== ticket) return;
    saveRouteBookmarks(new Set());
    saveFavorites(new Set());
    set({
      routes: new Set([...remote.routes, ...missingRoutes]),
      places: new Set([...remote.places, ...missingPlaces]),
      userId,
    });
  } catch {
    // Table missing or offline: keep working from this browser's copy.
    if (mine === ticket) set({ ...state, userId: null });
  }
}

function toggle(kind: SavedKind, slug: string): boolean {
  const key = kind === 'route' ? 'routes' : 'places';
  const next = new Set(state[key]);
  const saving = !next.has(slug);
  if (saving) next.add(slug);
  else next.delete(slug);
  const { userId } = state;
  set({ ...state, [key]: next });
  if (!userId) {
    if (kind === 'route') saveRouteBookmarks(next);
    else saveFavorites(next);
    return saving;
  }
  const write = saving ? addSaved(userId, kind, [slug]) : removeSaved(userId, kind, slug);
  write.catch(() => {
    // Put the heart back if the account refused it.
    const back = new Set(state[key]);
    if (saving) back.delete(slug);
    else back.add(slug);
    set({ ...state, [key]: back });
  });
  return saving;
}

export function toggleSavedRoute(slug: string): void {
  if (toggle('route', slug)) track('route_bookmarked', slug);
}

export function toggleSavedPlace(slug: string): void {
  toggle('place', slug);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Saved route slugs. The same Set object until something changes. */
export function useSavedRoutes(): Set<string> {
  return useSyncExternalStore(subscribe, () => state.routes);
}

/** Saved place slugs (venues and world summits). */
export function useSavedPlaces(): Set<string> {
  return useSyncExternalStore(subscribe, () => state.places);
}

/** Test hook: back to a fresh browser copy. */
export function resetSavedForTests(): void {
  ticket++;
  state = { routes: loadRouteBookmarks(), places: loadFavorites(), userId: null };
}
