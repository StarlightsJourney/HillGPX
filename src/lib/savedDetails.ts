import { useEffect, useMemo, useState } from 'react';
import { fetchCommunityRoutes } from './api';
import { isWorldPeakSlug, worldPeakBySlug } from './worldPeaks';
import { loadDataset } from './venues';
import type { Route, Venue } from '../types';

export interface SavedDetails {
  routes: Map<string, Route>;
  places: Map<string, Venue>;
}

/**
 * Names and numbers for saved slugs. Curated routes and local places come from
 * the static dataset, community routes from the API and world summits from
 * their tiles. A slug that cannot be resolved stays out of the maps and the
 * list shows it by a tidied slug instead, so a save is never hidden.
 * `ready` flips once the lookups have settled (or failed).
 */
export function useSavedDetails(routeSlugs: ReadonlySet<string>, placeSlugs: ReadonlySet<string>): SavedDetails & { ready: boolean } {
  const [details, setDetails] = useState<SavedDetails>({ routes: new Map(), places: new Map() });
  const [ready, setReady] = useState(false);
  const key = useMemo(() => `${[...routeSlugs].sort().join(',')}|${[...placeSlugs].sort().join(',')}`, [routeSlugs, placeSlugs]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const [dataset, community] = await Promise.all([loadDataset().catch(() => null), fetchCommunityRoutes().catch(() => [] as Route[])]);
      const routes = new Map<string, Route>();
      for (const route of [...(dataset?.routes ?? []), ...community]) if (routeSlugs.has(route.slug)) routes.set(route.slug, route);
      const places = new Map<string, Venue>();
      const missing: string[] = [];
      for (const slug of placeSlugs) {
        const venue = dataset?.bySlug.get(slug);
        if (venue) places.set(slug, venue);
        else if (isWorldPeakSlug(slug)) missing.push(slug);
      }
      const peaks = await Promise.all(missing.map((slug) => worldPeakBySlug(slug).catch(() => null)));
      for (const peak of peaks) if (peak) places.set(peak.slug, peak);
      if (!cancelled) {
        setDetails({ routes, places });
        setReady(true);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // `key` stands for the two sets' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { ...details, ready };
}

/** "southern-ridges" → "Southern ridges", for a save whose data could not be found. */
export function nameFromSlug(slug: string): string {
  const words = slug.replace(/^gn\d+-.*$/, 'Summit').replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}
