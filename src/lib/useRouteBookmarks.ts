import { useSyncExternalStore } from 'react';
import { track } from './analytics';
import { ROUTE_BOOKMARKS_KEY, loadRouteBookmarks, toggleRouteBookmark } from './venues';

/**
 * Route bookmarks shared by every heart on the page (cards, panel, category
 * bar). Storage goes through the helpers in `venues.ts`; this only keeps one
 * snapshot in memory and tells subscribers when it changes, including from
 * another tab.
 */
let snapshot: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();

function current(): ReadonlySet<string> {
  if (!snapshot) snapshot = loadRouteBookmarks();
  return snapshot;
}

function emit(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== ROUTE_BOOKMARKS_KEY) return;
  snapshot = loadRouteBookmarks();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

export function toggleBookmark(slug: string): void {
  const next = toggleRouteBookmark(slug);
  if (next.has(slug)) track('route_bookmarked', slug);
  snapshot = next;
  emit();
}

export function useRouteBookmarks(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, current, current);
}
