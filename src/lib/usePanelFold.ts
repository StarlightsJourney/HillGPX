import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * How long the map must rest after a pan or zoom by hand before the route
 * panel opens again. `moveend` already waits for drag inertia and the zoom
 * ease, so this only has to bridge the pause between two drags while someone
 * is still looking round the route; much longer and the panel feels stuck.
 */
export const PANEL_UNFOLD_MS = 700;

/**
 * Folds the open route's panel to a slim strip while the visitor moves the
 * map by hand, and opens it again once the map has rested or on a tap.
 * Keyed by the open route: switching routes always shows the new one whole,
 * with no reset effect (the fold belongs to the route it was made on).
 */
export function usePanelFold(routeSlug: string | null) {
  const [foldedSlug, setFoldedSlug] = useState<string | null>(null);
  const slugRef = useRef(routeSlug);
  slugRef.current = routeSlug;
  const timer = useRef<number | undefined>(undefined);

  const fold = useCallback(() => {
    window.clearTimeout(timer.current);
    setFoldedSlug(slugRef.current);
  }, []);
  const settle = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFoldedSlug(null), PANEL_UNFOLD_MS);
  }, []);
  const unfold = useCallback(() => {
    window.clearTimeout(timer.current);
    setFoldedSlug(null);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { folded: routeSlug !== null && foldedSlug === routeSlug, fold, settle, unfold };
}
