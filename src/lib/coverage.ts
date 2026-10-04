import type { CommunityStats } from './api';
import type { PeakIndex } from './worldPeaks';
import type { Dataset } from './venues';

/**
 * How much of the world the community has filled in. Everything is a count of
 * real records — mapped summits, places with a GPX, with a photo, with a
 * review — so the numbers move when someone contributes.
 */
export interface Coverage {
  summits: number;
  builtClimbs: number;
  countries: number;
  routes: number;
  placesWithRoutes: number;
  placesWithPhotos: number;
  reviews: number;
  /** Mapped hills and mountains that nobody has attached a GPX to yet. */
  summitsWithoutGpx: number;
  /** Share of all mapped places with at least one GPX, 0–1. */
  gpxShare: number;
  photoShare: number;
}

export function computeCoverage(dataset: Dataset, index: PeakIndex | null, stats: CommunityStats | null): Coverage {
  const hills = dataset.venues.filter((venue) => venue.type === 'hill');
  const summits = hills.length + (index?.total ?? 0);
  const builtClimbs = dataset.venues.length - hills.length;
  const total = summits + builtClimbs;

  const withRoutes = new Set(dataset.venues.filter((venue) => venue.routeSlugs.length > 0).map((venue) => venue.slug));
  for (const slug of stats?.routeVenues ?? []) withRoutes.add(slug);
  const withPhotos = new Set(dataset.venues.filter((venue) => venue.photo).map((venue) => venue.slug));
  for (const slug of stats?.photoVenues ?? []) withPhotos.add(slug);

  const hillSlugs = new Set(hills.map((venue) => venue.slug));
  const summitsWithRoutes = [...withRoutes].filter((slug) => hillSlugs.has(slug) || slug.startsWith('gn')).length;
  const publishedReviews = dataset.venues.reduce((acc, venue) => acc + (venue.rating?.count ?? 0), 0);

  return {
    summits,
    builtClimbs,
    countries: Math.max(index?.countries ?? 0, 1),
    routes: dataset.routes.length + (stats?.routes ?? 0),
    placesWithRoutes: withRoutes.size,
    placesWithPhotos: withPhotos.size,
    reviews: publishedReviews + (stats?.reviews ?? 0),
    summitsWithoutGpx: summits - summitsWithRoutes,
    gpxShare: total ? withRoutes.size / total : 0,
    photoShare: total ? withPhotos.size / total : 0,
  };
}

/** Percentages for tiny shares: "0.04%", never a misleading "0%". */
export function formatShare(share: number): string {
  if (share === 0) return '0%';
  const pct = share * 100;
  if (pct < 0.01) return '<0.01%';
  return `${pct < 1 ? pct.toFixed(2) : pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

export function compactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString();
}

/**
 * Community goals: plain round numbers of shared GPX routes. Past the last
 * one, the next goal is the next multiple of it.
 */
export const ROUTE_GOALS = [10, 25, 50, 100, 250, 500, 1000, 5000] as const;

export interface RouteGoal {
  /** Routes shared so far. */
  routes: number;
  /** The next round number to reach. */
  goal: number;
  /** Routes still needed to reach `goal`. */
  remaining: number;
  /** routes / goal, 0–1: the bar is filled out of the whole goal, not the step. */
  share: number;
}

export function routeGoal(routes: number): RouteGoal {
  const last = ROUTE_GOALS[ROUTE_GOALS.length - 1];
  const goal = ROUTE_GOALS.find((count) => routes < count) ?? (Math.floor(routes / last) + 1) * last;
  return { routes, goal, remaining: goal - routes, share: Math.min(1, Math.max(0, routes / goal)) };
}
