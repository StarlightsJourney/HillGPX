import type { Route, RouteActivity, RoutePoint } from '../types';
import { haversineM, totalDistanceM } from './elevation';

/**
 * What kind of outing a GPX is. Trail running and hiking are one category:
 * same paths, same climbing, different pace. Road running and cycling are
 * told apart from it mainly by climbing per km and, when the file has
 * timestamps, by moving speed.
 */
export const ACTIVITY_LABEL: Record<RouteActivity, string> = {
  run: 'Road run',
  trail: 'Trail',
  cycle: 'Cycling',
};

export function classifyActivity(points: RoutePoint[], gainM: number, times: (number | null)[] = []): RouteActivity {
  const km = totalDistanceM(points) / 1000;
  const gainPerKm = km > 0 ? gainM / km : 0;
  const speeds: number[] = [];
  for (let i = 1; i < points.length && i < times.length; i++) {
    const a = times[i - 1];
    const b = times[i];
    if (a == null || b == null || b <= a) continue;
    const kmh = (haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]) / 1000) / ((b - a) / 3_600_000);
    if (kmh > 1 && kmh < 120) speeds.push(kmh);
  }
  if (speeds.length >= 10) {
    speeds.sort((x, y) => x - y);
    const median = speeds[Math.floor(speeds.length / 2)];
    if (median >= 15) return 'cycle';
    if (median < 6.5 || gainPerKm >= 25) return 'trail';
    return 'run';
  }
  if (km > 80 && gainPerKm < 15) return 'cycle';
  return gainPerKm >= 25 ? 'trail' : 'run';
}

export function routeActivity(route: Route): RouteActivity {
  return route.activity ?? classifyActivity(route.coordinates, route.gainM);
}

/** Points every `stepM` metres along the line, so comparisons do not depend on GPS sampling rate. */
function resample(points: RoutePoint[], stepM: number): [number, number][] {
  if (points.length === 0) return [];
  const out: [number, number][] = [[points[0][0], points[0][1]]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [aLng, aLat] = points[i - 1];
    const [bLng, bLat] = points[i];
    const seg = haversineM(aLng, aLat, bLng, bLat);
    let d = stepM - carry;
    while (d <= seg) {
      const t = d / seg;
      out.push([aLng + (bLng - aLng) * t, aLat + (bLat - aLat) * t]);
      d += stepM;
    }
    carry = seg - (d - stepM);
  }
  return out;
}

/**
 * A fingerprint of the track's shape: 64 evenly spaced points rounded to ~11 m.
 * Re-uploading the same file (or a copy re-exported by another app) gives the
 * same value, which the database enforces as unique.
 */
export function routeFingerprint(points: RoutePoint[]): string {
  const total = totalDistanceM(points);
  const samples = resample(points, Math.max(total / 63, 1)).slice(0, 64);
  const text = samples.map(([lng, lat]) => `${lng.toFixed(4)},${lat.toFixed(4)}`).join(';');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const CELL = 0.0005;
const NEAR_M = 40;

/** Share (0–1) of route A that runs within ~40 m of route B. */
export function overlapShare(a: RoutePoint[], b: RoutePoint[]): number {
  const sa = resample(a, 25);
  const sb = resample(b, 25);
  if (sa.length === 0 || sb.length === 0) return 0;
  const grid = new Map<string, [number, number][]>();
  for (const p of sb) {
    const key = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(p);
    else grid.set(key, [p]);
  }
  let near = 0;
  for (const [lng, lat] of sa) {
    const cx = Math.floor(lng / CELL);
    const cy = Math.floor(lat / CELL);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (const q of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (haversineM(lng, lat, q[0], q[1]) <= NEAR_M) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) near += 1;
  }
  return near / sa.length;
}

export interface RouteOverlap {
  route: Route;
  /** Share of the subject route that shares ground with `route`. */
  share: number;
}

function boxesTouch(a: RoutePoint[], b: RoutePoint[]): boolean {
  const box = (pts: RoutePoint[]) => pts.reduce(
    (acc, [lng, lat]) => [Math.min(acc[0], lng), Math.min(acc[1], lat), Math.max(acc[2], lng), Math.max(acc[3], lat)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const [aw, as, ae, an] = box(a);
  const [bw, bs, be, bn] = box(b);
  return aw <= be && ae >= bw && as <= bn && an >= bs;
}

/** Other routes covering at least 15% of this one, most shared first. */
export function findOverlaps(points: RoutePoint[], others: Route[], selfSlug?: string): RouteOverlap[] {
  return others
    .filter((route) => route.slug !== selfSlug && route.coordinates.length > 1 && boxesTouch(points, route.coordinates))
    .map((route) => ({ route, share: overlapShare(points, route.coordinates) }))
    .filter((overlap) => overlap.share >= 0.15)
    .sort((x, y) => y.share - x.share);
}

/**
 * Near-identical: each covers 90% of the other and the distances agree within
 * 10%. Treated as a duplicate on upload even when the files differ.
 */
export function isSameRoute(points: RoutePoint[], other: Route): boolean {
  const d = totalDistanceM(points);
  if (Math.abs(d - other.distanceM) > 0.1 * Math.max(d, other.distanceM)) return false;
  return overlapShare(points, other.coordinates) >= 0.9 && overlapShare(other.coordinates, points) >= 0.9;
}
