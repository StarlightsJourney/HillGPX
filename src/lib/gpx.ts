import type { RoutePoint } from '../types';

/**
 * GPX parsing via the browser's own DOMParser — no dependency needed.
 *
 * Files dropped into the app are parsed here, in the tab, and never uploaded
 * anywhere. That is a deliberate property worth preserving: someone can analyse
 * a training route without handing their GPS history to a server.
 */

export interface ParsedGpx {
  name: string | null;
  /** Track points in file order. Elevation is whatever the file claimed. */
  points: RoutePoint[];
  /** Named waypoints, if the file carries any. */
  waypoints: { name: string | null; lng: number; lat: number }[];
  /** Timestamp of the first point, when present. */
  startedAt: string | null;
}

export class GpxParseError extends Error {}

export function parseGpx(xml: string): ParsedGpx {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new GpxParseError('That file is not valid XML.');
  }
  if (!doc.querySelector('gpx')) {
    throw new GpxParseError('That file has no <gpx> root — is it really a GPX?');
  }

  // Track points are the normal case; fall back to route points for files
  // exported as a planned route rather than a recorded activity.
  let nodes = Array.from(doc.getElementsByTagName('trkpt'));
  if (nodes.length === 0) nodes = Array.from(doc.getElementsByTagName('rtept'));

  const points: RoutePoint[] = [];
  for (const node of nodes) {
    const lat = Number(node.getAttribute('lat'));
    const lng = Number(node.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const eleText = node.getElementsByTagName('ele')[0]?.textContent;
    const ele = eleText ? Number(eleText) : 0;
    points.push([lng, lat, Number.isFinite(ele) ? ele : 0]);
  }

  if (points.length === 0) {
    throw new GpxParseError('No track or route points found in that GPX.');
  }

  const waypoints = Array.from(doc.getElementsByTagName('wpt'))
    .map((node) => ({
      name: node.getElementsByTagName('name')[0]?.textContent ?? null,
      lat: Number(node.getAttribute('lat')),
      lng: Number(node.getAttribute('lon')),
    }))
    .filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lng));

  const name =
    doc.querySelector('trk > name')?.textContent ??
    doc.querySelector('metadata > name')?.textContent ??
    doc.querySelector('rte > name')?.textContent ??
    null;

  const startedAt = nodes[0]?.getElementsByTagName('time')[0]?.textContent ?? null;

  return { name, points, waypoints, startedAt };
}

/**
 * Douglas–Peucker simplification, so a 20,000-point watch export does not
 * become 20,000 points of committed JSON. Tolerance is in degrees; 1e-5 is
 * roughly a metre at the equator.
 */
export function simplify(points: RoutePoint[], tolerance = 1e-5): RoutePoint[] {
  if (points.length <= 2) return points;

  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxSqDist = 0;
    let index = 0;

    for (let i = first + 1; i < last; i++) {
      const sqDist = sqSegmentDistance(points[i], points[first], points[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }

    if (maxSqDist > sqTol) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

function sqSegmentDistance(p: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Serialise points back out as a GPX route, for the session builder. */
export function toGpx(name: string, points: RoutePoint[], waypoints: ParsedGpx['waypoints'] = []): string {
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const wpts = waypoints
    .map(
      (w) =>
        `  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lng.toFixed(6)}">${
          w.name ? `<name>${esc(w.name)}</name>` : ''
        }</wpt>`,
    )
    .join('\n');
  const trkpts = points
    .map(
      ([lng, lat, ele]) =>
        `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"><ele>${ele.toFixed(1)}</ele></trkpt>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="hillGPX" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
${wpts}
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}
