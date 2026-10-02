import type { RoutePoint } from '../types';

/**
 * Worldwide ground elevation from the AWS Terrain Tiles (Terrarium encoding):
 * public, keyless, CORS-enabled PNGs where each pixel's RGB packs a height.
 * Used when a GPX carries no elevation (planned routes, many OSM relations) so
 * the app can still compute EG and EL honestly — and say where the numbers
 * came from — instead of showing "unavailable".
 */

const TILE_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium';
/** ~38 m per pixel at the equator: fine enough for trail gain, few tiles per route. */
const ZOOM = 12;
const SIZE = 256;

const tileCache = new Map<string, Promise<Float32Array | null>>();

function loadTile(x: number, y: number): Promise<Float32Array | null> {
  const key = `${x}/${y}`;
  let pending = tileCache.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(`${TILE_URL}/${ZOOM}/${x}/${y}.png`);
        if (!response.ok) return null;
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, SIZE, SIZE);
        const heights = new Float32Array(SIZE * SIZE);
        for (let i = 0; i < heights.length; i++) {
          heights[i] = data[i * 4] * 256 + data[i * 4 + 1] + data[i * 4 + 2] / 256 - 32768;
        }
        return heights;
      } catch {
        return null;
      }
    })();
    tileCache.set(key, pending);
  }
  return pending;
}

function worldPixel(lng: number, lat: number): [number, number] {
  const scale = SIZE * 2 ** ZOOM;
  const sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [((lng + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale];
}

async function heightAt(px: number, py: number): Promise<number | null> {
  // Bilinear between the four surrounding pixels, which may straddle tiles.
  const x0 = Math.floor(px - 0.5);
  const y0 = Math.floor(py - 0.5);
  const fx = px - 0.5 - x0;
  const fy = py - 0.5 - y0;
  const sample = async (x: number, y: number) => {
    const tile = await loadTile(Math.floor(x / SIZE), Math.floor(y / SIZE));
    return tile ? tile[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)] : null;
  };
  const [a, b, c, d] = await Promise.all([sample(x0, y0), sample(x0 + 1, y0), sample(x0, y0 + 1), sample(x0 + 1, y0 + 1)]);
  if (a == null || b == null || c == null || d == null) return null;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Replace each point's elevation with ground elevation; null if tiles failed. */
export async function terrainElevations(points: RoutePoint[]): Promise<RoutePoint[] | null> {
  const heights = await Promise.all(points.map(([lng, lat]) => heightAt(...worldPixel(lng, lat))));
  if (heights.some((h) => h == null)) return null;
  return points.map(([lng, lat], i) => [lng, lat, Math.round((heights[i] as number) * 10) / 10]);
}

/** A GPX "has elevation" only if its heights actually vary; many exports write zeros. */
export function hasRealElevation(points: RoutePoint[]): boolean {
  if (points.length < 2) return false;
  let min = Infinity;
  let max = -Infinity;
  for (const [, , ele] of points) {
    if (ele < min) min = ele;
    if (ele > max) max = ele;
  }
  return max - min >= 1;
}
