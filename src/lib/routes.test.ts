import kluangGpx from '../../data/routes/kluang-district-trail-run.gpx?raw';
import ridgesGpx from '../../data/routes/southern-ridges-walk.gpx?raw';
import { describe, expect, it } from 'vitest';
import { parseGpx } from './gpx';
import { NO_ROUTE_FILTERS, filterRoutes, routeFromPoints, routesBounds, routesNear, routesWithin } from './routes';

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
