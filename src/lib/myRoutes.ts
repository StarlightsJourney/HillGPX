import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { errorText } from './api';
import { fetchMyRoutes, useAuthUser, type MyUpload } from './auth';

/**
 * The signed-in user's published routes, fetched once and shared by the
 * avatar menu's counts and every account page, so they never disagree and the
 * list is not downloaded again on each page change.
 */
interface Snapshot {
  userId: string | null;
  routes: MyUpload[] | null;
  error: string | null;
}

let state: Snapshot = { userId: null, routes: null, error: null };
const listeners = new Set<() => void>();

function set(next: Snapshot): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function load(userId: string): void {
  fetchMyRoutes()
    .then((rows) => state.userId === userId && set({ userId, routes: rows, error: null }))
    .catch((err: unknown) => state.userId === userId && set({ userId, routes: null, error: errorText(err) }));
}

/** Drop a route from the shared list after it was deleted. */
export function forgetMyRoute(slug: string): void {
  if (state.routes) set({ ...state, routes: state.routes.filter((route) => route.slug !== slug) });
}

/** Prepend a route the user just published, so owner controls appear at once. */
export function addMyRoute(upload: MyUpload): void {
  if (state.routes && state.userId) {
    set({ ...state, routes: [upload, ...state.routes.filter((route) => route.slug !== upload.slug)] });
  }
}

/** Patch a route in the shared list after an edit (name, credit, stats). */
export function updateMyRoute(slug: string, patch: Partial<MyUpload>): void {
  if (state.routes) {
    set({ ...state, routes: state.routes.map((route) => (route.slug === slug ? { ...route, ...patch } : route)) });
  }
}

export function useMyRoutes(): { routes: MyUpload[] | null; error: string | null; reload: () => void } {
  const userId = useAuthUser()?.id ?? null;
  const snapshot = useSyncExternalStore(subscribe, () => state);

  useEffect(() => {
    if (state.userId === userId) return;
    set({ userId, routes: null, error: null });
    if (userId) load(userId);
  }, [userId]);

  const reload = useCallback(() => {
    if (!userId) return;
    set({ userId, routes: null, error: null });
    load(userId);
  }, [userId]);

  const mine = snapshot.userId === userId;
  return { routes: mine ? snapshot.routes : null, error: mine ? snapshot.error : null, reload };
}
