import type { DemHeader, RoutePoint } from '../types';

/**
 * Terrain model for Singapore, bundled with the app.
 *
 * Singapore fits in roughly 50 × 27 km, so a 30 m grid is about 1700 × 900
 * samples — a few megabytes as Int16 metres. That is small enough to ship as a
 * static asset, which is why elevation profiles here need no API, no key and no
 * network round-trip, and work offline.
 *
 * Never trust the elevation recorded in a GPX file. Consumer GPS altitude is
 * noisy enough that naively summing its deltas overstates gain badly; always
 * re-sample against this model instead. See `resampleElevation`.
 */
export class ElevationModel {
  private constructor(
    readonly header: DemHeader,
    private readonly grid: Int16Array,
  ) {}

  static async load(baseUrl = `${import.meta.env.BASE_URL}data/dem`): Promise<ElevationModel> {
    const [header, buffer] = await Promise.all([
      fetch(`${baseUrl}/sg-dem.json`).then((r) => {
        if (!r.ok) throw new Error(`DEM header missing (${r.status}) — run scripts/fetch_dem.py`);
        return r.json() as Promise<DemHeader>;
      }),
      fetch(`${baseUrl}/sg-dem.bin`).then((r) => {
        if (!r.ok) throw new Error(`DEM grid missing (${r.status}) — run scripts/fetch_dem.py`);
        return r.arrayBuffer();
      }),
    ]);

    const expected = header.width * header.height;
    const grid = new Int16Array(buffer);
    if (grid.length !== expected) {
      throw new Error(`DEM size mismatch: header says ${expected} samples, grid has ${grid.length}`);
    }
    return new ElevationModel(header, grid);
  }

  /** Raw grid lookup by integer column/row. Returns NaN outside the grid. */
  private at(col: number, row: number): number {
    const { width, height, noData } = this.header;
    if (col < 0 || col >= width || row < 0 || row >= height) return NaN;
    const v = this.grid[row * width + col];
    return v === noData ? NaN : v;
  }

  /**
   * Elevation in metres at a coordinate, bilinearly interpolated between the
   * four surrounding samples. Returns NaN outside Singapore or over no-data.
   */
  sample(lng: number, lat: number): number {
    const { west, south, east, north, width, height } = this.header;
    if (lng < west || lng > east || lat < south || lat > north) return NaN;

    // Fractional grid position. Row 0 is the northern edge.
    const x = ((lng - west) / (east - west)) * (width - 1);
    const y = ((north - lat) / (north - south)) * (height - 1);

    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;

    const v00 = this.at(x0, y0);
    const v10 = this.at(x0 + 1, y0);
    const v01 = this.at(x0, y0 + 1);
    const v11 = this.at(x0 + 1, y0 + 1);

    // If any corner is missing, fall back to the nearest valid sample rather
    // than poisoning the whole interpolation with NaN.
    if ([v00, v10, v01, v11].some(Number.isNaN)) {
      const valid = [v00, v10, v01, v11].filter((v) => !Number.isNaN(v));
      return valid.length ? valid[0] : NaN;
    }

    const top = v00 * (1 - fx) + v10 * fx;
    const bottom = v01 * (1 - fx) + v11 * fx;
    return top * (1 - fy) + bottom * fy;
  }

  /** Replace each point's elevation with the terrain-model value. */
  resampleElevation(points: RoutePoint[]): RoutePoint[] {
    return points.map(([lng, lat, ele]) => {
      const sampled = this.sample(lng, lat);
      return [lng, lat, Number.isNaN(sampled) ? ele : sampled] as RoutePoint;
    });
  }
}

/** Great-circle distance in metres between two coordinates. */
export function haversineM(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6371008.8;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLng = (bLng - aLng) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function totalDistanceM(points: RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return total;
}

/** Moving-average smoothing over the elevation channel. */
function smoothElevation(points: RoutePoint[], window: number): number[] {
  const eles = points.map((p) => p[2]);
  if (window <= 1) return eles;
  const half = Math.floor(window / 2);
  return eles.map((_, i) => {
    const lo = Math.max(0, i - half);
    const hi = Math.min(eles.length - 1, i + half);
    let sum = 0;
    for (let j = lo; j <= hi; j++) sum += eles[j];
    return sum / (hi - lo + 1);
  });
}

export interface GainOptions {
  /**
   * Ignore rises and falls smaller than this, in metres. Filters out sensor and
   * interpolation noise that would otherwise accumulate into hundreds of phantom
   * metres over a long route. 2 m suits DEM-derived elevation; raise it towards
   * 5 m if you are forced to use raw GPS altitude.
   */
  thresholdM?: number;
  /** Width of the smoothing window, in points. */
  smoothWindow?: number;
}

export interface GainResult {
  gainM: number;
  lossM: number;
  minM: number;
  maxM: number;
}

/**
 * Cumulative elevation gain and loss.
 *
 * Deltas are accumulated only once a monotonic run exceeds `thresholdM`, which
 * is what keeps a flat road from reading as 200 m of climbing.
 */
export function computeGain(points: RoutePoint[], opts: GainOptions = {}): GainResult {
  const { thresholdM = 2, smoothWindow = 5 } = opts;
  if (points.length < 2) return { gainM: 0, lossM: 0, minM: 0, maxM: 0 };

  const eles = smoothElevation(points, smoothWindow);

  let gain = 0;
  let loss = 0;
  let anchor = eles[0];
  let min = eles[0];
  let max = eles[0];

  for (let i = 1; i < eles.length; i++) {
    const e = eles[i];
    min = Math.min(min, e);
    max = Math.max(max, e);

    const delta = e - anchor;
    if (delta >= thresholdM) {
      gain += delta;
      anchor = e;
    } else if (delta <= -thresholdM) {
      loss += -delta;
      anchor = e;
    }
  }

  return {
    gainM: Math.round(gain),
    lossM: Math.round(loss),
    minM: Math.round(min),
    maxM: Math.round(max),
  };
}
