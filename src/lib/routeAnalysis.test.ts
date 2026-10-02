import kluangGpx from '../../data/routes/kluang-district-trail-run.gpx?raw';
import ridgesGpx from '../../data/routes/southern-ridges-walk.gpx?raw';
import { describe, expect, it } from 'vitest';
import type { Route, RoutePoint } from '../types';
import { parseGpx } from './gpx';
import { computeGain } from './elevation';
import { classifyActivity, findOverlaps, isSameRoute, routeFingerprint } from './routeAnalysis';
import { routeFromPoints } from './routes';

const kluang = parseGpx(kluangGpx);
const ridges = parseGpx(ridgesGpx);
const asRoute = (name: string, points: RoutePoint[]): Route => routeFromPoints(name, points, []);

describe('gpx timestamps', () => {
  it('keeps one time slot per point and a recorded date', () => {
    expect(kluang.times).toHaveLength(kluang.points.length);
    if (kluang.times.some((t) => t != null)) expect(kluang.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('activity', () => {
  it('reads a steep jungle loop as trail', () => {
    expect(classifyActivity(kluang.points, computeGain(kluang.points).gainM, kluang.times)).toBe('trail');
  });

  it('reads fast moving speed as cycling', () => {
    const points: RoutePoint[] = Array.from({ length: 40 }, (_, i) => [103.8 + i * 0.002, 1.3, 10]);
    const times = points.map((_, i) => i * 25_000); // ~220 m per 25 s ≈ 32 km/h
    expect(classifyActivity(points, 5, times)).toBe('cycle');
  });

  it('reads flat steady pace as a road run', () => {
    const points: RoutePoint[] = Array.from({ length: 40 }, (_, i) => [103.8 + i * 0.002, 1.3, 10]);
    const times = points.map((_, i) => i * 70_000); // ~11 km/h
    expect(classifyActivity(points, 5, times)).toBe('run');
  });
});

describe('duplicates and overlaps', () => {
  it('gives the same fingerprint for the same track, different for another', () => {
    expect(routeFingerprint(kluang.points)).toBe(routeFingerprint([...kluang.points]));
    expect(routeFingerprint(kluang.points)).not.toBe(routeFingerprint(ridges.points));
  });

  it('treats a thinned copy as the same route', () => {
    const thinned = kluang.points.filter((_, i) => i % 2 === 0);
    expect(isSameRoute(thinned, asRoute('Kluang', kluang.points))).toBe(true);
    expect(isSameRoute(ridges.points, asRoute('Kluang', kluang.points))).toBe(false);
  });

  it('finds a partial overlap', () => {
    const half = kluang.points.slice(0, Math.floor(kluang.points.length / 2));
    const [overlap] = findOverlaps(half, [asRoute('Kluang', kluang.points), asRoute('Ridges', ridges.points)]);
    expect(overlap.route.name).toBe('Kluang');
    expect(overlap.share).toBeGreaterThan(0.9);
  });
});
