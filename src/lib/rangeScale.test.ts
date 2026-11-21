import { describe, expect, it } from 'vitest';
import {
  barHeight,
  buildScale,
  distanceKind,
  durationKind,
  heightKind,
  histogram,
  matchShare,
  neighbourStop,
  parseMinutes,
  positionOf,
  stopAt,
} from './rangeScale';

const km = distanceKind('metric');

describe('buildScale', () => {
  const distances = [4_300, 5_400, 6_800, 10_700, 14_200, 62_400, 70_300, 82_700];

  it('puts the stops on round numbers and tops the track at a whole bar', () => {
    const scale = buildScale(distances, km.steps);
    expect(scale.step % 1000).toBe(0);
    expect(scale.stops[0]).toBe(0);
    expect(scale.stops[scale.stops.length - 1]).toBe(scale.hi);
    expect(scale.hi % scale.bar).toBe(0);
    expect(scale.bar % scale.step).toBe(0);
    expect(scale.hi).toBeGreaterThanOrEqual(82_700);
    expect(scale.stops.length).toBeLessThanOrEqual(23);
  });

  it('makes every bar edge a stop a handle can reach', () => {
    const scale = buildScale(Array.from({ length: 60 }, (_, i) => 2_000 + i * 900), km.steps);
    for (let i = 0; i <= scale.bars; i += 1) expect(scale.stops).toContain(Number((i * scale.bar).toFixed(6)));
  });

  it('draws fewer, wider bars for a few routes and more for many', () => {
    const few = buildScale(Array.from({ length: 12 }, (_, i) => 3_000 + i * 6_000), km.steps);
    const many = buildScale(Array.from({ length: 4_000 }, (_, i) => 3_000 + (i % 80) * 1_000), km.steps);
    expect(few.bars).toBeGreaterThanOrEqual(4);
    expect(few.bars).toBeLessThanOrEqual(12);
    expect(many.bars).toBeGreaterThan(few.bars);
    expect(many.bars).toBeLessThanOrEqual(20);
  });

  it('is not stretched by one huge outlier', () => {
    const many = Array.from({ length: 40 }, (_, i) => 3_000 + i * 500);
    const scale = buildScale([...many, 1_900_000], km.steps);
    expect(scale.hi).toBeLessThan(40_000);
    expect(scale.truncated).toBe(true);
  });

  it('handles an empty or all-zero pool', () => {
    expect(buildScale([], km.steps).stops).toEqual([0, 500]);
    expect(buildScale([0, 0], km.steps).hi).toBe(500);
    expect(buildScale([0, 0], km.steps).bars).toBe(1);
  });

  it('follows the reader’s units: stops land on whole miles when imperial', () => {
    const mi = distanceKind('imperial');
    const scale = buildScale(distances, mi.steps);
    expect(Math.abs(scale.step / 1609.344 - Math.round(scale.step / 1609.344))).toBeLessThan(1e-6);
  });

  it('time stops fall on whole five-minute units', () => {
    const scale = buildScale([6, 9, 12, 18, 21, 30, 60, 90], durationKind.steps);
    expect(Number.isInteger(scale.step)).toBe(true);
    expect(Number.isInteger(scale.bar)).toBe(true);
  });
});

describe('moving along the track', () => {
  const scale = buildScale([5_000, 10_000, 20_000, 40_000], km.steps);

  it('places a value, with anything past the top at the end', () => {
    expect(positionOf(0, scale)).toBe(0);
    expect(positionOf(scale.hi, scale)).toBe(1);
    expect(positionOf(scale.hi * 3, scale)).toBe(1);
  });

  it('snaps a point on the track to the nearest stop', () => {
    expect(scale.stops[stopAt(0, scale)]).toBe(0);
    expect(scale.stops[stopAt(1, scale)]).toBe(scale.hi);
  });

  it('finds the next stop each way, and none past the ends', () => {
    expect(neighbourStop(0, 1, scale)).toBe(scale.step);
    expect(neighbourStop(scale.step * 1.4, 1, scale)).toBe(scale.step * 2);
    expect(neighbourStop(scale.step * 1.4, -1, scale)).toBe(scale.step);
    expect(neighbourStop(0, -1, scale)).toBeNull();
    expect(neighbourStop(scale.hi, 1, scale)).toBeNull();
  });
});

describe('bars', () => {
  const pool = [2_000, 2_500, 3_000, 4_000, 30_000];
  const scale = buildScale(pool, km.steps);

  it('counts every value in some bar, folding anything past the top into the last', () => {
    const counts = histogram([...pool, 500_000], scale);
    expect(counts).toHaveLength(scale.bars);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(6);
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(1);
  });

  it('gives the tallest bar the full height and any populated bar at least a stub', () => {
    expect(barHeight(9, 9)).toBe(1);
    expect(barHeight(1, 400)).toBeGreaterThanOrEqual(0.14);
    expect(barHeight(4, 16)).toBeCloseTo(0.5, 5);
  });

  it('keeps an empty bar short but still there, so the row has no gaps', () => {
    expect(barHeight(0, 9)).toBeGreaterThan(0);
    expect(barHeight(0, 9)).toBeLessThan(barHeight(1, 9));
    expect(barHeight(0, 0)).toBeGreaterThan(0);
  });

  it('fills the share of a bar that passes the other filters, with a visible minimum', () => {
    expect(matchShare(0, 8)).toBe(0);
    expect(matchShare(8, 8)).toBe(1);
    expect(matchShare(2, 8)).toBe(0.25);
    expect(matchShare(1, 100)).toBeGreaterThanOrEqual(0.1);
    expect(matchShare(3, 0)).toBe(0);
  });
});

describe('distance field', () => {
  it('shows and reads kilometres to a tenth', () => {
    expect(km.label(12_500)).toBe('12.5 km');
    expect(km.label(12_000)).toBe('12 km');
    expect(km.fromField('12.5')).toBe(12_500);
    expect(km.fromField('12,5')).toBe(12_500);
    expect(km.fromField(' 10 km ')).toBe(10_000);
    expect(km.fromField('0')).toBe(0);
    expect(km.fromField('10.04')).toBe(10_000);
  });

  it('refuses what is not a number, a negative, or another unit', () => {
    expect(km.fromField('abc')).toBeNull();
    expect(km.fromField('-5')).toBeNull();
    expect(km.fromField('10 mi')).toBeNull();
    expect(km.fromField('')).toBeNull();
  });

  it('reads miles when the reader uses miles', () => {
    const mi = distanceKind('imperial');
    expect(mi.fromField('10')).toBeCloseTo(16_093.44, 1);
    expect(mi.label(16_093.44)).toBe('10 mi');
    expect(mi.label(8_046.72)).toBe('5 mi');
    expect(mi.fromField('10 km')).toBeNull();
  });

  it('labels a bound without a stray .0', () => {
    expect(km.label(0)).toBe('0 km');
    expect(km.label(80_000)).toBe('80 km');
    expect(km.label(82_700)).toBe('82.7 km');
  });
});

describe('elevation gain field', () => {
  it('works in whole metres or feet', () => {
    const m = heightKind('metric');
    expect(m.fromField('254.6')).toBe(255);
    expect(m.fromField('300 m')).toBe(300);
    expect(m.fromField('300 ft')).toBeNull();
    expect(m.label(399)).toBe('399 m');
    const ft = heightKind('imperial');
    expect(ft.fromField('1000')).toBeCloseTo(304.8, 1);
    expect(ft.label(304.8)).toBe('1000 ft');
  });
});

describe('time field', () => {
  it('reads minutes, hours and a clock time', () => {
    expect(parseMinutes('90')).toBe(90);
    expect(parseMinutes('45 min')).toBe(45);
    expect(parseMinutes('1h')).toBe(60);
    expect(parseMinutes('1h30')).toBe(90);
    expect(parseMinutes('1 h 30 min')).toBe(90);
    expect(parseMinutes('1.5h')).toBe(90);
    expect(parseMinutes('1:30')).toBe(90);
    expect(parseMinutes('2 hours')).toBe(120);
  });

  it('refuses what is not a time', () => {
    expect(parseMinutes('soon')).toBeNull();
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('1.5')).toBeNull();
  });

  it('keeps five-minute units, rounding what is typed', () => {
    expect(durationKind.fromField('90')).toBe(18);
    expect(durationKind.fromField('37')).toBe(7);
    expect(durationKind.label(18)).toBe('1 h 30 min');
    expect(durationKind.label(0)).toBe('0 min');
    expect(durationKind.label(12)).toBe('1 h');
  });
});
