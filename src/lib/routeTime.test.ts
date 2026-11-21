import { describe, expect, it } from 'vitest';
import type { Route, RoutePoint } from '../types';
import {
  climbProfile,
  estimateProfile,
  estimateRouteTimeS,
  estimateTrackDuration,
  formatDuration,
  formatEstimate,
  roundDurationMinutes,
  routeEstimateS,
} from './routeTime';

const M_PER_DEG_LNG = 111_194.9; // at the equator, on the 6,371,008.8 m sphere haversineM uses

/**
 * A straight track heading east from the equator, a point every `stepM` (20 m, so no bucket edge falls on exactly 75 m), that
 * climbs evenly: `gainM` over `km` kilometres.
 */
function slope(km: number, gainM: number, stepM = 20): RoutePoint[] {
  const count = Math.round((km * 1000) / stepM);
  return Array.from({ length: count + 1 }, (_, i) => [(i * stepM) / M_PER_DEG_LNG, 0, (gainM * i) / count] as RoutePoint);
}

const minutes = (points: RoutePoint[], activity: Parameters<typeof estimateTrackDuration>[1] = 'run') =>
  estimateTrackDuration(points, activity).minutes;

describe('climbProfile', () => {
  it('measures a straight track and splits its climb by steepness', () => {
    const gentle = climbProfile(slope(3, 150)); // 5%
    const steep = climbProfile(slope(1, 150)); // 15%
    expect(gentle.distanceKm).toBeCloseTo(3, 2);
    expect(gentle.steepM).toBe(0);
    expect(gentle.gentleM).toBeGreaterThan(130);
    expect(steep.gentleM).toBe(0);
    expect(steep.steepM).toBeGreaterThan(125);
  });

  it('puts the boundary at 10%: up to it is gentle, above it steep', () => {
    expect(climbProfile(slope(2, 190)).steepM).toBe(0); // 9.5%
    expect(climbProfile(slope(2, 230)).gentleM).toBe(0); // 11.5%
  });

  it('ignores GPS jitter between neighbouring points', () => {
    // A flat track whose altimeter flickers by ±1.5 m climbs nothing.
    const flat = slope(5, 0).map((p, i): RoutePoint => [p[0], p[1], i % 2 ? 1.5 : -1.5]);
    const profile = climbProfile(flat);
    expect(profile.gentleM + profile.steepM).toBe(0);
  });

  it('drops points that did not move (a pause at a light) and counts nothing for them', () => {
    const track = slope(2, 40);
    const paused = track.flatMap((p, i) => (i % 5 === 0 ? [p, p, p] : [p]));
    expect(climbProfile(paused)).toEqual(climbProfile(track));
  });

  it('clamps a corrupt spike to a 35% grade', () => {
    const track = slope(2, 0);
    track[40] = [track[40][0], 0, 5_000];
    const profile = climbProfile(track);
    // One 75 m bucket can add at most 35% of its length; the smoothing spreads the rest.
    expect(profile.steepM).toBeLessThan(150);
  });

  it('has no climb for a track with no elevation, however it is written', () => {
    const none = slope(10, 0);
    expect(climbProfile(none).gentleM).toBe(0);
    const missing = slope(10, 300).map((p): RoutePoint => [p[0], p[1], Number.NaN]);
    const profile = climbProfile(missing);
    expect(profile.gentleM + profile.steepM).toBe(0);
    expect(profile.distanceKm).toBeCloseTo(10, 1);
    // Told the elevation is not known, the given values are ignored.
    const ignored = climbProfile(slope(10, 300), false);
    expect(ignored.gentleM + ignored.steepM).toBe(0);
  });

  it('copes with too few points', () => {
    expect(climbProfile([])).toEqual({ distanceKm: 0, gentleM: 0, steepM: 0 });
    expect(climbProfile([[0, 0, 5]])).toEqual({ distanceKm: 0, gentleM: 0, steepM: 0 });
  });
});

describe('roundDurationMinutes', () => {
  it('rounds to 5 minutes under 2 h, 10 up to 6 h, 15 beyond', () => {
    expect(roundDurationMinutes(72)).toBe(70); // 1h 12m
    expect(roundDurationMinutes(334)).toBe(330); // 5h 34m
    expect(roundDurationMinutes(924)).toBe(930); // 15h 24m
  });
});

describe('formatDuration', () => {
  it('reads as hours and minutes', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(930)).toBe('15h 30m');
  });
});

describe('estimating a duration', () => {
  it('does not speed up a short run: a flat 3 km is 3 km at the base speed', () => {
    const estimate = estimateTrackDuration(slope(3, 0), 'run');
    expect(estimate.minutes).toBe(20); // 3 / 9 km/h, with no fatigue discount below 10 km
    expect(estimate.effectiveDistanceKm).toBeCloseTo(3, 1);
  });

  it('times a steep climb at 1.4 times its gentle cost', () => {
    const gentle = estimateProfile({ distanceKm: 10, gentleM: 500, steepM: 0 }, 'run');
    const steep = estimateProfile({ distanceKm: 10, gentleM: 0, steepM: 500 }, 'run');
    expect(gentle.effectiveDistanceKm).toBeCloseTo(15, 5);
    expect(steep.effectiveDistanceKm).toBeCloseTo(17, 5);
    expect(steep.minutes).toBeGreaterThan(gentle.minutes);
  });

  it('times a steep track slower than a gentle one with the same climb', () => {
    const steepTrail = estimateTrackDuration(slope(2, 300), 'trail'); // 15%
    const gentleTrail = estimateTrackDuration(slope(6, 300), 'trail'); // 5%
    expect(steepTrail.effectiveDistanceKm).toBeGreaterThan(2 + 1.4 * 2.7); // 1.4 x ~270 m or more of steep climb
    expect(gentleTrail.effectiveDistanceKm).toBeLessThanOrEqual(6 + 3.01);
  });

  it('rides faster than it runs, and a trail takes longer than the road over the same ground', () => {
    const track = slope(20, 200);
    expect(minutes(track, 'cycle')).toBeLessThan(minutes(track, 'run'));
    expect(minutes(track, 'trail')).toBeGreaterThan(minutes(track, 'run'));
    expect(minutes(track, undefined)).toBe(minutes(track, 'run'));
  });

  it('stretches the whole time for a slower runner', () => {
    const track = slope(10, 50);
    expect(estimateTrackDuration(track, 'run', 1.2).minutes).toBeGreaterThan(minutes(track) * 1.15);
  });

  it('falls back to distance and total climb, counted as gentle, when there is no track', () => {
    // 10 km and 100 m: Deq 11 km, (11 / 9) h x 1.1^0.09 = 74 min, rounded to 75.
    expect(estimateRouteTimeS(10_000, 100, 'run')).toBe(75 * 60);
    expect(estimateRouteTimeS(5_000, 0, undefined)).toBe(estimateRouteTimeS(5_000, 0, 'run'));
    expect(estimateRouteTimeS(10_000, -50, 'trail')).toBe(estimateRouteTimeS(10_000, 0, 'trail'));
  });

  it('carries the caption and the effective distance with the time', () => {
    const estimate = estimateProfile({ distanceKm: 109, gentleM: 330, steepM: 0 }, 'run');
    expect(estimate).toEqual({
      minutes: 930,
      formatted: '15h 30m',
      effectiveDistanceKm: 112.3,
      caption: 'Realistic average time based on distance, climbing, and endurance fatigue.',
    });
  });
});

describe('benchmarks', () => {
  // Each target assumes the gentle climbing a typical route of that length has.
  it('a 10 km run with a little climbing is about 1h 10m', () => {
    expect(minutes(slope(10, 50))).toBe(70);
  });

  it('a marathon is about 5h 30m', () => {
    // Targets of ~5h 35m: the rounding to 10 minutes lands on 5h 30m.
    expect(minutes(slope(42.195, 100))).toBe(330);
  });

  it('a 109 km road run is about 15h 30m', () => {
    expect(minutes(slope(109, 300))).toBe(930);
  });

  it('a 120 km ride is about 7h 15m', () => {
    expect(minutes(slope(120, 950), 'cycle')).toBe(435);
  });
});

describe('routeEstimateS', () => {
  const route = (over: Partial<Route>): Route =>
    ({
      slug: 'r',
      name: 'R',
      distanceM: 10_000,
      gainM: 100,
      lossM: 100,
      coordinates: slope(10, 100),
      ...over,
    }) as Route;

  it('reads the track and returns seconds, rounded to a clean number of minutes', () => {
    const seconds = routeEstimateS(route({}));
    expect(seconds % 300).toBe(0);
    expect(seconds).toBeGreaterThan(65 * 60);
    expect(seconds).toBeLessThan(80 * 60);
  });

  it('counts no climb when the elevation is unknown', () => {
    expect(routeEstimateS(route({ elevationAvailable: false }))).toBe(estimateRouteTimeS(10_000, 0, 'run'));
  });

  it('falls back to the stored distance and gain without usable coordinates', () => {
    expect(routeEstimateS(route({ coordinates: [] }))).toBe(estimateRouteTimeS(10_000, 100, 'run'));
  });

  it('scales with the runner’s pace', () => {
    expect(routeEstimateS(route({}), 1.25)).toBeGreaterThan(routeEstimateS(route({})));
  });
});

describe('formatEstimate', () => {
  it('rounds to 5 minutes and reads as hours and minutes', () => {
    expect(formatEstimate(2 * 60)).toBe('~5 min');
    expect(formatEstimate(43 * 60)).toBe('~45 min');
    expect(formatEstimate(60 * 60)).toBe('~1 h');
    expect(formatEstimate((3 * 60 + 17) * 60)).toBe('~3 h 15 min');
    expect(formatEstimate((59 * 60) + 40)).toBe('~1 h');
  });
});
