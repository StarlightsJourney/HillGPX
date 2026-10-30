import { describe, expect, it } from 'vitest';
import type { RoutePoint } from '../types';
import { parseGpx } from './gpx';
import { hasRealElevation } from './terrain';
import { assessRoute, describeFlag, type QualityInput } from './routeQuality';

const gpxFiles = import.meta.glob('../../data/routes/*.gpx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** ~11 m per step heading east, one fix every `stepS` seconds. */
function walk(n: number, opts: { stepS?: number; degPerStep?: number; ele?: (i: number) => number } = {}) {
  const { stepS = 5, degPerStep = 0.0001, ele = () => 10 } = opts;
  const points: RoutePoint[] = Array.from({ length: n }, (_, i) => [103.8 + i * degPerStep, 1.3, ele(i)]);
  const times = points.map((_, i) => i * stepS * 1000);
  return { points, times };
}

const assess = (over: Partial<QualityInput> & Pick<QualityInput, 'points'>) =>
  assessRoute({ activity: 'run', hasElevation: true, deviceElevation: true, ...over });
const ids = (r: ReturnType<typeof assessRoute>) => r.flags.map((f) => f.id);

// Parsing the larger files with jsdom's DOM parser is slow when the whole suite runs in parallel.
describe('real routes', { timeout: 30_000 }, () => {
  for (const [path, xml] of Object.entries(gpxFiles)) {
    it(`is not held: ${path.split('/').pop()}`, () => {
      const parsed = parseGpx(xml);
      const result = assess({ points: parsed.points, times: parsed.times, hasElevation: hasRealElevation(parsed.points) });
      expect(result.flags.filter((f) => f.severity === 'key')).toEqual([]);
      expect(result.verdict).toBe('ok');
    });
  }
});

describe('a clean track', () => {
  it('passes with no flags', () => {
    const { points, times } = walk(200, { stepS: 4 });
    expect(assess({ points, times })).toEqual({ verdict: 'ok', flags: [] });
  });
});

describe('too short', () => {
  it('holds a track under 300 m', () => {
    const { points, times } = walk(12, { degPerStep: 0.00005 }); // ~60 m
    const result = assess({ points, times });
    expect(result.verdict).toBe('held');
    expect(ids(result)).toContain('too-short');
  });

  it('holds a track with fewer than 10 points', () => {
    const { points, times } = walk(8, { degPerStep: 0.01 });
    expect(ids(assess({ points, times }))).toContain('too-short');
  });
});

describe('gps jump', () => {
  it('holds a teleport that stays displaced', () => {
    const { points, times } = walk(100);
    const moved = points.map((p, i): RoutePoint => (i >= 50 ? [p[0] + 0.5, p[1], p[2]] : p));
    const result = assess({ points: moved, times });
    expect(result.verdict).toBe('held');
    expect(ids(result)).toContain('gps-jump');
  });

  it('tolerates a lone out-and-back spike', () => {
    const { points, times } = walk(100);
    const spiked = points.map((p, i): RoutePoint => (i === 50 ? [p[0] + 0.5, p[1], p[2]] : p));
    expect(assess({ points: spiked, times })).toEqual({ verdict: 'ok', flags: [] });
  });

  it('uses the gap between points when there are no timestamps', () => {
    const { points } = walk(100);
    const moved = points.map((p, i): RoutePoint => (i >= 50 ? [p[0] + 0.5, p[1], p[2]] : p));
    expect(ids(assess({ points: moved }))).toContain('gps-jump');
  });

  it('does not read the long gaps of a simplified track as jumps', () => {
    const points: RoutePoint[] = Array.from({ length: 12 }, (_, i) => [103.8 + i * 0.03, 1.3, 10]); // ~3.3 km apart
    expect(ids(assess({ points, spacing: 'simplified' }))).not.toContain('gps-jump');
  });

  it('says where along the track it happened', () => {
    const { points, times } = walk(100);
    const moved = points.map((p, i): RoutePoint => (i >= 50 ? [p[0] + 0.5, p[1], p[2]] : p));
    const flag = assess({ points: moved, times }).flags.find((f) => f.id === 'gps-jump');
    expect(flag?.at).toBeGreaterThan(0.4);
    expect(flag?.at).toBeLessThan(0.6);
  });
});

describe('impossible speed', () => {
  it('holds sustained car speed on a run', () => {
    const { points, times } = walk(120, { stepS: 5, degPerStep: 0.0012 }); // ~130 m / 5 s ≈ 94 km/h
    expect(ids(assess({ points, times }))).toContain('impossible-speed');
  });

  it('allows a bike fast speed that a runner would not', () => {
    const { points, times } = walk(120, { stepS: 5, degPerStep: 0.0004 }); // ~44 m / 5 s ≈ 32 km/h
    expect(ids(assess({ points, times, activity: 'cycle' }))).not.toContain('impossible-speed');
    expect(ids(assess({ points, times, activity: 'run' }))).not.toContain('impossible-speed');
    const faster = walk(120, { stepS: 5, degPerStep: 0.0007 }); // ~78 m / 5 s ≈ 56 km/h
    expect(ids(assess({ points: faster.points, times: faster.times, activity: 'cycle' }))).not.toContain('impossible-speed');
    expect(ids(assess({ points: faster.points, times: faster.times, activity: 'run' }))).toContain('impossible-speed');
  });

  it('skips speed checks without timestamps', () => {
    const { points } = walk(120, { degPerStep: 0.0012 });
    expect(ids(assess({ points }))).not.toContain('impossible-speed');
  });
});

describe('elevation', () => {
  it('only notes a missing elevation, and does not hold', () => {
    const { points, times } = walk(200, { stepS: 4 });
    const result = assess({ points, times, hasElevation: false });
    expect(result.verdict).toBe('ok');
    expect(result.flags.map((f) => [f.id, f.severity])).toEqual([['no-elevation', 'advisory']]);
  });

  it('holds an altimeter that jumps hundreds of metres in a second', () => {
    const { points, times } = walk(100, { stepS: 2, ele: (i) => (i === 40 ? 900 : 10) });
    expect(ids(assess({ points, times }))).toContain('implausible-elevation');
  });

  it('holds noise that climbs hundreds of metres per km', () => {
    const { points, times } = walk(400, { stepS: 5, degPerStep: 0.00009, ele: (i) => i * 8 }); // 8 m per ~10 m
    expect(ids(assess({ points, times }))).toContain('implausible-elevation');
  });

  it('does not check terrain-filled heights', () => {
    const { points, times } = walk(400, { stepS: 5, degPerStep: 0.00009, ele: (i) => i * 8 });
    expect(ids(assess({ points, times, deviceElevation: false }))).not.toContain('implausible-elevation');
  });
});

describe('wording', () => {
  it('turns every flag into a sentence that tells the uploader what to do', () => {
    const { points, times } = walk(8, { degPerStep: 0.01 });
    const text = assess({ points, times }).flags.map(describeFlag).join(' ');
    expect(text).toMatch(/only 8 points/);
  });
});
