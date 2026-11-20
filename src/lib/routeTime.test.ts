import { describe, expect, it } from 'vitest';
import { estimateRouteTimeS, formatEstimate } from './routeTime';

describe('estimateRouteTimeS', () => {
  it('matches the run planner for a run', () => {
    // 10 km at 6:30/km plus 100 m of climb at 30 s per 10 m.
    expect(estimateRouteTimeS(10_000, 100, 'run')).toBe(3900 + 300);
  });

  it('treats a route with no activity as a run', () => {
    expect(estimateRouteTimeS(5_000, 0, undefined)).toBe(estimateRouteTimeS(5_000, 0, 'run'));
  });

  it('orders the activities: a ride is quicker than a run, a trail slower', () => {
    const [run, trail, cycle] = (['run', 'trail', 'cycle'] as const).map((a) => estimateRouteTimeS(20_000, 200, a));
    expect(cycle).toBeLessThan(run);
    expect(run).toBeLessThan(trail);
  });

  it('adds time for climbing and ignores a negative gain', () => {
    expect(estimateRouteTimeS(10_000, 300, 'trail')).toBeGreaterThan(estimateRouteTimeS(10_000, 0, 'trail'));
    expect(estimateRouteTimeS(10_000, -50, 'trail')).toBe(estimateRouteTimeS(10_000, 0, 'trail'));
  });
});

describe('formatEstimate', () => {
  it('rounds to five minutes and says it is approximate', () => {
    expect(formatEstimate(2 * 60)).toBe('~5 min');
    expect(formatEstimate(43 * 60)).toBe('~45 min');
    expect(formatEstimate(60 * 60)).toBe('~1 h');
    expect(formatEstimate((3 * 60 + 17) * 60)).toBe('~3 h 15 min');
    expect(formatEstimate((59 * 60) + 40)).toBe('~1 h');
  });
});
