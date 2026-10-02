/**
 * The camera for a route's card image, shared by the browser and by
 * `scripts/render_route_thumbs.ts`. The script renders the basemap once with
 * this view and stores it; the card then draws the trace over that picture
 * with the same Web Mercator maths, so the two line up without the browser
 * ever loading MapLibre for a thumbnail.
 *
 * No imports on purpose: Node runs the script with plain type stripping.
 */

export const THUMB_W = 400;
export const THUMB_H = 300;

/**
 * The trace is fitted inside the middle 300 × 300 so it survives both crops the
 * image is shown at: square on the landing tiles and 4:3 in lists. The bottom
 * keeps room for the elevation silhouette.
 */
const FIT = { left: 74, right: 326, top: 26, bottom: 238 };
const MAX_ZOOM = 16;
/** MapLibre's world is 512 px wide at zoom 0. */
const TILE = 512;

export interface ThumbView {
  centre: [number, number];
  zoom: number;
  /** Stable for a given view, so a stale stored image is never paired with a changed route. */
  key: string;
  project: (lng: number, lat: number) => [number, number];
}

const mercX = (lng: number) => (lng + 180) / 360;
const mercY = (lat: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const lngOf = (x: number) => x * 360 - 180;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function thumbView(points: ReadonlyArray<readonly [number, number, ...number[]]>): ThumbView | null {
  if (points.length < 2) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [lng, lat] of points) {
    const x = mercX(lng);
    const y = mercY(lat);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const scale = Math.min(
    (FIT.right - FIT.left) / Math.max(maxX - minX, 1e-9),
    (FIT.bottom - FIT.top) / Math.max(maxY - minY, 1e-9),
    TILE * 2 ** MAX_ZOOM,
  );
  // Round the zoom so the key and the rendered image agree exactly.
  const zoom = Math.round(Math.log2(scale / TILE) * 1000) / 1000;
  const s = TILE * 2 ** zoom;
  const cx = (minX + maxX) / 2 + (THUMB_W / 2 - (FIT.left + FIT.right) / 2) / s;
  const cy = (minY + maxY) / 2 + (THUMB_H / 2 - (FIT.top + FIT.bottom) / 2) / s;
  const centre: [number, number] = [Number(lngOf(cx).toFixed(6)), Number(latOf(cy).toFixed(6))];
  const ox = mercX(centre[0]);
  const oy = mercY(centre[1]);
  return {
    centre,
    zoom,
    key: hash(`${centre[0]},${centre[1]},${zoom}`),
    project: (lng, lat) => [THUMB_W / 2 + (mercX(lng) - ox) * s, THUMB_H / 2 + (mercY(lat) - oy) * s],
  };
}

/** Where the stored basemap for a route lives, relative to the site root. */
export function thumbPath(slug: string, view: ThumbView): string {
  return `route-thumbs/${slug}-${view.key}.jpg`;
}
