import type { RouteActivity } from '../types';

/**
 * One stroke icon per activity, on a 24×24 grid, shared by the category bar,
 * route cards and the route pins on the map so the three always agree.
 */
export const ACTIVITY_PATHS: Record<RouteActivity, string> = {
  // A runner mid-stride, leaning forward from one shoulder point: reads at
  // 14 px where a shoe outline did not, and no longer tips backwards.
  run: 'M14.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z M13 8l-2.5 6 M13 8l3 3h3 M13 8 9 8.5 6.5 11 M10.5 14l3.5 2.5-1 4.5 M10.5 14 8 17.5H4.5',
  // A summit with a path up it.
  trail: 'M2 19 9 7l3.5 5.5L15 9l7 10Z M9 7l1.6 2.8M6.5 15.5l2-1.5 1.5 1 2-2',
  // A bicycle.
  cycle: 'M5.5 17.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M18.5 17.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M5.5 14l4-6.5h5.5L18.5 14 M9.5 7.5 12 14h1.5l3-6.5 M8.5 5.5h3',
};

export function activityGlyphSvg(activity: RouteActivity, size = 16, stroke = 1.8): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ACTIVITY_PATHS[activity]}"/></svg>`;
}
