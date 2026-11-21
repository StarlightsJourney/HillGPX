import { describe, expect, it } from 'vitest';
import {
  BUCKETS,
  buildScale,
  distanceKind,
  durationKind,
  heightKind,
  histogram,
  neighbourStop,
  parseMinutes,
  positionOf,
  stopAt,
} from './rangeScale';

const km = distanceKind('metric');

describe('buildScale', () => {
  const distances = [4_300, 5_400, 6_800, 10_700, 14_200, 62_400, 70_300, 82_700];

  it('runs from 0 to the 95th percentile in at most twenty equal steps', () => {
    const scale = buildScale(distances);
    expect(scale.stops[0]).toBe(0);
    expect(scale.stops[scale.stops.length - 1]).toBe(scale.hi);
    expect(scale.hi).toBe(82_700);
    expect(scale.stops.length).toBeLessThanOrEqual(BUCKETS + 2);
    expect(scale.step).toBe(Math.ceil(82_700 / BUCKETS));
  });

  it('is not stretched by one huge outlier', () => {
    const many = Array.from({ length: 40 }, (_, i) => 3_000 + i * 500);
    const scale = buildScale([...many, 1_900_000]);
    expect(scale.hi).toBeLessThan(40_000);
    expect(scale.truncated).toBe(true);
  });

  it('handles an empty pool', () => {
    expect(buildScale([]).stops).toEqual([0, 1]);
  });
});

describe('moving along the track', () => {
  const scale = buildScale([5_000, 10_000, 20_000, 40_000]);

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

describe('histogram', () => {
  it('counts every value in some bucket, folding anything past the top into the last', () => {
    const pool = [2_000, 2_500, 3_000, 4_000, 30_000];
    const scale = buildScale(pool);
    const counts = histogram([...pool, 500_000], scale);
    expect(counts).toHaveLength(BUCKETS);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(6);
    expect(counts[BUCKETS - 1]).toBeGreaterThanOrEqual(1);
  });
});

describe('distance field', () => {
  it('reads kilometres to a tenth, with or without the unit', () => {
    expect(km.fromField('12.5')).toBe(12_500);
    expect(km.fromField('12,5')).toBe(12_500);
    expect(km.fromField(' 10 km ')).toBe(10_000);
    expect(km.fromField('0')).toBe(0);
    expect(km.fromField('10.04')).toBe(10_000);
  });

  it('reads a distance written in metres', () => {
    expect(km.fromField('800 m')).toBe(800);
  });

  it('refuses what is not a number, a negative, or another system’s unit', () => {
    expect(km.fromField('abc')).toBeNull();
    expect(km.fromField('-5')).toBeNull();
    expect(km.fromField('10 mi')).toBeNull();
    expect(km.fromField('')).toBeNull();
  });

  it('reads miles and feet when the reader uses them', () => {
    const mi = distanceKind('imperial');
    expect(mi.fromField('10')).toBeCloseTo(16_093.44, 1);
    expect(mi.fromField('500 ft')).toBeCloseTo(152.4, 1);
    expect(mi.fromField('10 km')).toBeNull();
  });

  it('prints a bound as the filters always have', () => {
    expect(km.label(0)).toBe('0 m');
    expect(km.label(14_200)).toBe('14.2 km');
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

  it('reads back what the filter prints, tilde and all', () => {
    expect(parseMinutes('~1 h 30 min')).toBe(90);
    expect(durationKind.fromField(durationKind.label(18))).toBe(18);
  });

  it('refuses what is not a time', () => {
    expect(parseMinutes('soon')).toBeNull();
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('1.5')).toBeNull();
  });

  it('keeps five-minute units, rounding what is typed', () => {
    expect(durationKind.fromField('90')).toBe(18);
    expect(durationKind.fromField('37')).toBe(7);
    expect(durationKind.label(0)).toBe('0 min');
    expect(durationKind.label(18)).toBe('~1 h 30 min');
  });
});
