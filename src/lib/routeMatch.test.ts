import kluangGpx from '../../data/routes/kluang-district-trail-run.gpx?raw';
import ridgesGpx from '../../data/routes/southern-ridges-walk.gpx?raw';
import hk2Gpx from '../../data/routes/hong-kong-trail-section-2.gpx?raw';
import hk4Gpx from '../../data/routes/hong-kong-trail-section-4.gpx?raw';
import utsgGpx from '../../data/routes/utsg-60km-final-revised.gpx?raw';
import { describe, expect, it } from 'vitest';
import { parseGpx } from './gpx';
import { routeFromPoints } from './routes';
import { DEFAULT_PACE_S_PER_KM, matchRoutes, type RunNeeds } from './routeMatch';

const load = (name: string, gpx: string) => routeFromPoints(name, parseGpx(gpx).points, []);
// Real routes, as parsed: Southern Ridges 10.7 km, 305 m EG, 28 m/km
// (Rolling); Kluang 14.4 km at 105 m/km (Hilly); Hong Kong Trail 2 4.3 km at
// 53 m/km and section 4 6.8 km at 50 m/km (Hilly); UTSG 62 km at 15 m/km
// (Rolling).
const ridges = load('Southern Ridges', ridgesGpx);
const kluang = load('Kluang', kluangGpx);
const hk2 = load('Hong Kong Trail 2', hk2Gpx);
const hk4 = load('Hong Kong Trail 4', hk4Gpx);
const utsg = load('UTSG', utsgGpx);
const all = [ridges, kluang, hk2, hk4, utsg];

const needs = (over: Partial<RunNeeds>): RunNeeds => ({
  where: null,
  length: null,
  terrain: 'any',
  paceSPerKm: DEFAULT_PACE_S_PER_KM,
  ...over,
});
const order = (n: RunNeeds, routes = all) => matchRoutes(routes, n).matches.map((m) => m.route.name);

describe('matchRoutes', () => {
  it('gives nothing for no routes', () => {
    expect(matchRoutes([], needs({ length: { kind: 'distance', metres: 10_000 } })).matches).toEqual([]);
  });

  describe('length', () => {
    it('puts the route closest to the target length first', () => {
      expect(order(needs({ length: { kind: 'distance', metres: 10_000 } }))[0]).toBe('Southern Ridges');
      expect(order(needs({ length: { kind: 'distance', metres: 4_000 } }))[0]).toBe('Hong Kong Trail 2');
      expect(order(needs({ length: { kind: 'distance', metres: 60_000 } }))[0]).toBe('UTSG');
    });
  });

  describe('time', () => {
    const at = (name: string, n: RunNeeds) => matchRoutes(all, n).matches.find((m) => m.route.name === name)!;

    it('estimates duration from the pace plus a climbing allowance', () => {
      // Southern Ridges: 10.74 km at 6:30/km is 69.8 min, plus 305 m of climb
      // at 30 s per 10 m is 15.25 min: about 85 minutes.
      expect(at('Southern Ridges', needs({})).durationS / 60).toBeCloseTo(85.1, 0);
      // At 8:00/km: 85.9 + 15.25.
      expect(at('Southern Ridges', needs({ paceSPerKm: 480 })).durationS / 60).toBeCloseTo(101.2, 0);
    });

    it('matches a target time against the estimate, so a hilly route of the same length counts as longer', () => {
      // 45 min at 6:30/km is 6.9 km, which on length alone is HK Trail 4
      // (6.8 km). Its 344 m of climb adds 17 min (62 min all in), so the
      // shorter section 2 (40 min all in) fits 45 minutes better.
      expect(order(needs({ length: { kind: 'distance', metres: 6_900 } }))[0]).toBe('Hong Kong Trail 4');
      expect(order(needs({ length: { kind: 'time', minutes: 45 } }))[0]).toBe('Hong Kong Trail 2');
    });
  });

  describe('terrain', () => {
    it('Hilly puts the steep routes first', () => {
      expect(new Set(order(needs({ terrain: 'hilly' })).slice(0, 3))).toEqual(new Set(['Kluang', 'Hong Kong Trail 2', 'Hong Kong Trail 4']));
    });

    it('Rolling puts the 10–30 m/km routes first', () => {
      expect(new Set(order(needs({ terrain: 'rolling' })).slice(0, 2))).toEqual(new Set(['Southern Ridges', 'UTSG']));
    });

    it('Flat prefers the gentlest route when none is truly flat', () => {
      expect(order(needs({ terrain: 'flat' })).slice(0, 2)).toEqual(['UTSG', 'Southern Ridges']);
    });

    it('Any ignores terrain', () => {
      const scores = matchRoutes(all, needs({ terrain: 'any' })).matches.map((m) => m.score);
      expect(new Set(scores).size).toBe(1);
    });

    it('gives a route without elevation a neutral terrain score and says so', () => {
      const unknown = { ...kluang, name: 'No elevation', elevationAvailable: false };
      const ranked = matchRoutes([...all, unknown], needs({ terrain: 'flat' })).matches;
      const names = ranked.map((m) => m.route.name);
      // Below UTSG (15 m/km, near enough flat), above the steep routes it really is.
      expect(names.indexOf('No elevation')).toBe(1);
      expect(names.indexOf('No elevation')).toBeLessThan(names.indexOf('Kluang'));
      const match = ranked.find((m) => m.route.name === 'No elevation')!;
      expect(match.reasons).toContainEqual({ kind: 'terrain', band: null, climbRateMPerKm: null });
    });
  });

  describe('where', () => {
    // Mount Faber, on the Southern Ridges; Kluang town, a few km from its trail run.
    const FABER = { kind: 'point', lng: 103.8196, lat: 1.2741 } as const;
    const KLUANG = { kind: 'point', lng: 103.3328, lat: 2.0301 } as const;
    // The same Southern Ridges walk, moved ~100 km north: just as good, but far.
    const farRidges = {
      ...ridges,
      slug: 'far-ridges',
      name: 'Far Ridges',
      coordinates: ridges.coordinates.map(([lng, lat, ele]) => [lng, lat + 0.9, ele] as [number, number, number]),
    };

    it('ranks a near route above an equally good one 100 km away', () => {
      const ranked = matchRoutes([farRidges, ridges], needs({ where: FABER }), { reachM: [200_000] }).matches;
      expect(ranked.map((m) => m.route.name)).toEqual(['Southern Ridges', 'Far Ridges']);
      expect(ranked[0].reasons[0]).toEqual({ kind: 'away', metres: expect.any(Number) });
      expect((ranked[0].reasons[0] as { metres: number }).metres).toBeLessThan(200);
      expect((ranked[1].reasons[0] as { metres: number }).metres).toBeGreaterThan(90_000);
    });

    it('leaves out routes beyond the 5 km reach', () => {
      const fromFaber = matchRoutes(all, needs({ where: FABER }));
      expect(fromFaber.reachM).toBe(5_000);
      expect(fromFaber.matches.map((m) => m.route.name)).not.toContain('Kluang');
      expect(fromFaber.matches.map((m) => m.route.name)).not.toContain('Hong Kong Trail 2');
      expect(fromFaber.matches.map((m) => m.route.name)).toContain('Southern Ridges');

      const fromKluang = matchRoutes(all, needs({ where: KLUANG }), { reachM: [1_000, 50_000] });
      expect(fromKluang.reachM).toBe(50_000);
      expect(fromKluang.matches.map((m) => m.route.name)).toEqual(['Kluang']);
    });

    it('finds nothing when every route is out of reach', () => {
      expect(matchRoutes(all, needs({ where: { kind: 'point', lng: 90, lat: -40 } }))).toEqual({ matches: [], reachM: null });
    });

    it('counts a route crossing the area as 0 km away', () => {
      const hongKongIsland = { kind: 'area', bounds: { west: 114.1, south: 22.2, east: 114.3, north: 22.3 } } as const;
      const ranked = matchRoutes(all, needs({ where: hongKongIsland })).matches;
      expect(new Set(ranked.map((m) => m.route.name))).toEqual(new Set(['Hong Kong Trail 2', 'Hong Kong Trail 4']));
      for (const m of ranked) expect(m.reasons[0]).toEqual({ kind: 'away', metres: 0 });
    });

    it('keeps an area to the routes in it: no widening around a country', () => {
      // A box over the north of Singapore: the Southern Ridges are ~12 km
      // south of it, within the 50 km a point would widen to.
      const north = { kind: 'area', bounds: { west: 103.6, south: 1.4, east: 104.0, north: 1.48 } } as const;
      expect(matchRoutes([ridges], needs({ where: north }))).toEqual({ matches: [], reachM: null });
    });

    describe('labels and reasons', () => {
      const ridgesFrom = (n: Partial<RunNeeds>) =>
        matchRoutes([ridges], needs({ where: FABER, terrain: 'rolling', ...n })).matches[0];

      it('is a Great match when near, the right length and the right terrain', () => {
        const m = ridgesFrom({ length: { kind: 'distance', metres: 11_000 } });
        expect(m.label).toBe('great');
        expect(m.misses).toEqual([]);
        expect(m.reasons).toEqual([
          { kind: 'away', metres: expect.any(Number) },
          { kind: 'length', metres: 10_741, durationS: expect.any(Number) },
          { kind: 'terrain', band: 'rolling', climbRateMPerKm: expect.any(Number) },
        ]);
        expect(Math.round((m.reasons[2] as { climbRateMPerKm: number }).climbRateMPerKm)).toBe(28);
      });

      it('is a Good match when a few km off, and says by how much', () => {
        const m = ridgesFrom({ length: { kind: 'distance', metres: 7_000 } });
        expect(m.label).toBe('good');
        expect(m.misses).toEqual([{ kind: 'length', unit: 'distance', by: 3_741, longer: true }]);
      });

      it('is a Partial match when far off what was asked, and says what is off', () => {
        const m = ridgesFrom({ length: { kind: 'time', minutes: 45 }, terrain: 'flat' });
        expect(m.label).toBe('partial');
        // 85 min estimated against 45 asked.
        expect(m.misses[0]).toMatchObject({ kind: 'length', unit: 'time', longer: true });
        expect(Math.round((m.misses[0] as { by: number }).by / 60)).toBe(40);
        expect(m.misses[1]).toEqual({ kind: 'terrain', wanted: 'flat', band: 'rolling' });
      });

      it('reports a shorter route as shorter', () => {
        const m = ridgesFrom({ length: { kind: 'distance', metres: 20_000 } });
        expect(m.misses).toEqual([{ kind: 'length', unit: 'distance', by: 9_259, longer: false }]);
      });
    });

    it('breaks a tie with the closer route before the loop', () => {
      // The same route twice, one a loop starting 2 km further from the runner.
      const nearLine = { ...ridges, slug: 'near', name: 'Near line', loop: false };
      const farLoop = {
        ...ridges,
        slug: 'far',
        name: 'Far loop',
        loop: true,
        coordinates: ridges.coordinates.map(([lng, lat, ele]) => [lng, lat + 0.018, ele] as [number, number, number]),
      };
      const below = { kind: 'point', lng: 103.8196, lat: 1.2 } as const;
      const ranked = matchRoutes([farLoop, nearLine], needs({ where: below }), { reachM: [10_000] }).matches;
      expect(ranked.map((m) => m.route.name)).toEqual(['Near line', 'Far loop']);
    });

    it('breaks ties with the loop', () => {
      expect(order(needs({}), [ridges, kluang]).at(0)).toBe('Kluang');
    });
  });
});
