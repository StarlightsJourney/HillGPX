import kluangGpx from '../../data/routes/kluang-district-trail-run.gpx?raw';
import ridgesGpx from '../../data/routes/southern-ridges-walk.gpx?raw';
import { describe, expect, it } from 'vitest';
import { parseGpx } from './gpx';
import { NO_ROUTE_FILTERS, filterRoutes, nearestPointOnRoute, routeFromPoints, routesBounds, routesNear, routesWithin } from './routes';

const kluang = routeFromPoints('Kluang', parseGpx(kluangGpx).points, []);
const ridges = routeFromPoints('Southern Ridges', parseGpx(ridgesGpx).points, []);
const routes = [kluang, ridges];

// Mount Faber, on the Southern Ridges; Kluang is ~100 km north in Johor.
const FABER = { lng: 103.8196, lat: 1.2741 };

describe('routesNear', () => {
  it('finds a route that passes close by, and not one 100 km away', () => {
    expect(routesNear(routes, FABER.lng, FABER.lat, 5_000, 8)).toEqual([ridges]);
  });

  it('orders by closest approach and honours the limit', () => {
    const both = routesNear(routes, FABER.lng, FABER.lat, 200_000, 8);
    expect(both).toEqual([ridges, kluang]);
    expect(routesNear(routes, FABER.lng, FABER.lat, 200_000, 1)).toEqual([ridges]);
  });

  it('finds nothing in the open sea', () => {
    expect(routesNear(routes, 90, -40, 50_000, 8)).toEqual([]);
  });
});

describe('routesBounds', () => {
  it('covers every route given', () => {
    const box = routesBounds(routes);
    expect(box).not.toBeNull();
    for (const [lng, lat] of [...kluang.coordinates, ...ridges.coordinates]) {
      expect(lng).toBeGreaterThanOrEqual(box!.west);
      expect(lng).toBeLessThanOrEqual(box!.east);
      expect(lat).toBeGreaterThanOrEqual(box!.south);
      expect(lat).toBeLessThanOrEqual(box!.north);
    }
  });

  it('is null for nothing', () => {
    expect(routesBounds([])).toBeNull();
  });
});

describe('filterRoutes: Saved (bookmarks) and On this device', () => {
  const local = { ...kluang, slug: 'local-kluang', source: 'local' as const };
  const pool = [{ ...ridges, slug: 'southern-ridges', source: 'curated' as const }, local];

  it('lists only bookmarked routes under Saved, wherever they come from', () => {
    const saved = filterRoutes(pool, { ...NO_ROUTE_FILTERS, category: 'bookmarked' }, new Set(['southern-ridges']));
    expect(saved.map((r) => r.slug)).toEqual(['southern-ridges']);
  });

  it('shows nothing under Saved without bookmarks', () => {
    expect(filterRoutes(pool, { ...NO_ROUTE_FILTERS, category: 'bookmarked' })).toEqual([]);
  });

  it('keeps On this device to GPX files saved locally, not bookmarks', () => {
    const device = filterRoutes(pool, { ...NO_ROUTE_FILTERS, category: 'saved' }, new Set(['southern-ridges']));
    expect(device.map((r) => r.slug)).toEqual(['local-kluang']);
  });
});

describe('routesWithin', () => {
  // Kluang town centre: the Kluang trail run is a few km out, Southern Ridges ~100 km south.
  const KLUANG = { lng: 103.3328, lat: 2.0301 };

  it('stops at the first radius that has routes', () => {
    expect(routesWithin(routes, FABER.lng, FABER.lat, [10_000, 50_000], 8)).toEqual({ radiusM: 10_000, routes: [ridges] });
  });

  it('widens when the first radius is empty', () => {
    expect(routesWithin(routes, KLUANG.lng, KLUANG.lat, [1_000, 50_000], 8)?.radiusM).toBe(50_000);
  });

  it('is null when even the widest radius is empty', () => {
    expect(routesWithin(routes, 90, -40, [10_000, 50_000], 8)).toBeNull();
  });
});

describe('nearestPointOnRoute', () => {
  it('snaps a runner standing on the trail to that point along it', () => {
    // Point 100 of the Southern Ridges file is (103.770189, 1.297556), near Kent Ridge Park;
    // the trail runs north-south there, and the runner's GPS reads ~10 m east of it.
    const hit = nearestPointOnRoute(ridges, 103.770279, 1.297556);
    expect(hit.index).toBe(100);
    expect(hit.distanceM).toBeLessThan(15);
    expect(hit.onRoute).toBe(true);
  });

  it('says a runner 1 km away is not on the route', () => {
    // 1 km due west of the trail's start at (103.762723, 1.298794).
    const hit = nearestPointOnRoute(ridges, 103.753730, 1.298794);
    expect(hit.onRoute).toBe(false);
    expect(hit.distanceM).toBeGreaterThan(950);
    expect(hit.distanceM).toBeLessThan(1050);
  });

  it('snaps positions at the start and the end to the first and last points', () => {
    // The file runs from Kent Ridge (103.762723, 1.298794) to HarbourFront (103.821551, 1.265829), 880 points.
    expect(nearestPointOnRoute(ridges, 103.762723, 1.298794)).toEqual({ index: 0, distanceM: 0, onRoute: true });
    // A GPS fix 15 m off either end still snaps to that end.
    expect(nearestPointOnRoute(ridges, 103.762600, 1.298850).index).toBe(0);
    expect(nearestPointOnRoute(ridges, 103.821551, 1.265829).index).toBe(879);
    expect(nearestPointOnRoute(ridges, 103.821650, 1.265750).index).toBe(879);
  });
});
