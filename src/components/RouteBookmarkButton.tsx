import type { Route } from '../types';
import { toggleBookmark, useRouteBookmarks } from '../lib/useRouteBookmarks';
import { HeartIcon } from './icons';

/**
 * The heart that bookmarks a route on this device. One label, with
 * `aria-pressed` carrying the on/off state; the tooltip says what a tap does.
 * `variant` picks the look: over a card photo, or a round panel button.
 */
export function RouteBookmarkButton({ route, variant }: { route: Route; variant: 'card' | 'panel' }) {
  const bookmarks = useRouteBookmarks();
  const on = bookmarks.has(route.slug);
  const tip = on ? 'Remove from Saved' : 'Save route';
  return (
    <button
      type="button"
      className={`${variant === 'card' ? 'card-favorite route-bookmark' : 'gpx-icon-btn route-bookmark-panel'}${on ? ' on' : ''}`}
      aria-label={`Save ${route.name}`}
      aria-pressed={on}
      title={variant === 'card' ? tip : undefined}
      data-tip={variant === 'panel' ? tip : undefined}
      onClick={(event) => {
        event.stopPropagation();
        toggleBookmark(route.slug);
      }}
    >
      <HeartIcon size={variant === 'card' ? 24 : 15} filled={on} />
    </button>
  );
}
