import { useSyncExternalStore } from 'react';

/** Whether a CSS media query matches, kept in sync as the window changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phones and narrow windows: the header packs into one row below this width. */
export const NARROW_HEADER = '(max-width: 743px)';
