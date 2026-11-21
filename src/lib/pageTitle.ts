import { useEffect } from 'react';

/** The title index.html ships with: what every page shows until it names itself. */
const DEFAULT_TITLE = typeof document === 'undefined' ? '' : document.title;

/** "Bukit Timah Hill · hillGPX": the page's own name, then the site's. */
export function pageTitle(label: string): string {
  return `${label} · hillGPX`;
}

/**
 * Names the browser tab after the page for as long as it is shown, and puts
 * the default back when it goes. `null` leaves the default (still loading).
 */
export function usePageTitle(label: string | null): void {
  useEffect(() => {
    if (!label) return;
    document.title = pageTitle(label);
    return () => {
      document.title = DEFAULT_TITLE;
    };
  }, [label]);
}
