import type { Bounds } from '../lib/venues';

/** Web Mercator stops just short of the poles; a box past that cannot be framed. */
const MAX_LAT = 85;

/** Any longitude, folded into [-180, 180). */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * A box MapLibre can actually frame on a map drawn without world copies
 * (`renderWorldCopies: false`).
 *
 * Boxes that cross the antimeridian arrive two ways: with `west > east`
 * (Fiji as 177, -178) or with an edge past ±180 (Fiji as 177, 182). With one
 * copy of the world on screen there is no camera that shows both sides of the
 * line, so frame the side with more of the box on it: mainland USA rather than
 * the far Aleutians, North Island and South Island rather than the Chathams.
 * Latitudes are ordered and clamped to what Mercator can show.
 */
export function frameableBounds(bounds: Bounds): Bounds {
  const south = Math.max(-MAX_LAT, Math.min(bounds.south, bounds.north));
  const north = Math.min(MAX_LAT, Math.max(bounds.south, bounds.north));
  const { west, east } = bounds;

  if (west <= east && east - west >= 360) return { west: -180, south, east: 180, north };
  if (west <= east && west >= -180 && east <= 180) return { west, south, east, north };

  const w = wrapLng(west);
  // 180 itself wraps to -180, which would turn a box ending on the line into
  // one starting there.
  const e = east === 180 ? 180 : wrapLng(east);
  if (w <= e) return { west: w, south, east: e, north };

  // Still crossing after folding: keep the larger side of the line.
  return 180 - w >= e + 180 ? { west: w, south, east: 180, north } : { west: -180, south, east: e, north };
}

/** True when every edge is a real number; a hash typo should not move the camera. */
export function isFiniteBounds(bounds: Bounds): boolean {
  return [bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite);
}
