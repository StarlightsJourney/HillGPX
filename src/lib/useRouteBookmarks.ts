import { toggleSavedRoute, useSavedRoutes } from './saved';

/**
 * Route bookmarks shared by every heart on the page (cards, panel, category
 * bar). They are the account's saved routes when signed in and this browser's
 * copy when not; `saved.ts` holds the one snapshot.
 */
export const toggleBookmark = toggleSavedRoute;
export const useRouteBookmarks = useSavedRoutes;
