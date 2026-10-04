import { describe, expect, it } from 'vitest';
import { frameableBounds, isFiniteBounds, wrapLng } from './camera';

describe('wrapLng', () => {
  it('folds longitudes into [-180, 180)', () => {
    expect(wrapLng(0)).toBe(0);
    expect(wrapLng(182)).toBe(-178);
    expect(wrapLng(-190)).toBe(170);
    expect(wrapLng(540)).toBe(-180);
  });
});

describe('frameableBounds', () => {
  it('leaves an ordinary box alone', () => {
    const japan = { west: 129.4, south: 30.9, east: 145.9, north: 45.6 };
    expect(frameableBounds(japan)).toEqual(japan);
  });

  it('keeps a box that ends exactly on the antimeridian', () => {
    expect(frameableBounds({ west: 170, south: -50, east: 180, north: -30 })).toEqual({ west: 170, south: -50, east: 180, north: -30 });
  });

  it('frames the larger side of a box given as west > east (Fiji)', () => {
    expect(frameableBounds({ west: 177, south: -19.2, east: -178, north: -16 })).toEqual({ west: 177, south: -19.2, east: 180, north: -16 });
  });

  it('frames the larger side of a box given with east past 180 (USA with the Aleutians)', () => {
    // 172°E to 66°W, written as 172..294.
    expect(frameableBounds({ west: 172, south: 18, east: 294, north: 72 })).toEqual({ west: -180, south: 18, east: -66, north: 72 });
  });

  it('frames the larger side for Russia (19°E to 169°W)', () => {
    expect(frameableBounds({ west: 19, south: 41, east: -169, north: 82 })).toEqual({ west: 19, south: 41, east: 180, north: 82 });
  });

  it('shifts a box that lies wholly past 180 back onto the map', () => {
    expect(frameableBounds({ west: 190, south: 0, east: 200, north: 10 })).toEqual({ west: -170, south: 0, east: -160, north: 10 });
  });

  it('shows the whole world for a box wider than the world', () => {
    expect(frameableBounds({ west: -200, south: -60, east: 200, north: 70 })).toEqual({ west: -180, south: -60, east: 180, north: 70 });
  });

  it('orders and clamps latitudes', () => {
    expect(frameableBounds({ west: 0, south: 89, east: 10, north: -89 })).toEqual({ west: 0, south: -85, east: 10, north: 85 });
  });
});

describe('isFiniteBounds', () => {
  it('rejects NaN edges', () => {
    expect(isFiniteBounds({ west: Number.NaN, south: 0, east: 1, north: 1 })).toBe(false);
    expect(isFiniteBounds({ west: 0, south: 0, east: 1, north: 1 })).toBe(true);
  });
});
