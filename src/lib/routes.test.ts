import kluangGpx from '../../data/routes/kluang-district-trail-run.gpx?raw';
import ridgesGpx from '../../data/routes/southern-ridges-walk.gpx?raw';
import { describe, expect, it } from 'vitest';
import { parseGpx } from './gpx';
import { routeFromPoints, routesBounds, routesNear } from './routes';

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
