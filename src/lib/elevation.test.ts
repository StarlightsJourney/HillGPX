import { describe, expect, it } from 'vitest';
import { haversineM, totalDistanceM } from './elevation';

describe('haversineM', () => {
  it('returns roughly 1 km for one degree of latitude near the equator', () => {
    const distance = haversineM(103.8, 1.35, 103.8, 2.35);
    expect(distance).toBeGreaterThan(110_000);
    expect(distance).toBeLessThan(112_000);
  });

  it('returns zero for identical points', () => {
    expect(haversineM(103.8, 1.35, 103.8, 1.35)).toBe(0);
  });
});

describe('totalDistanceM', () => {
  it('sums segment distances', () => {
    const points: [number, number, number][] = [
      [103.8, 1.35, 0],
      [103.8, 1.36, 0],
      [103.8, 1.37, 0],
    ];
    const total = totalDistanceM(points);
    expect(total).toBeGreaterThan(2_200);
    expect(total).toBeLessThan(2_300);
  });
});
