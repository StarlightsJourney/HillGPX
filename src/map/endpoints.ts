import { Marker, type Map as MlMap } from 'maplibre-gl';
import { parseSvg } from '../lib/dom';
import { routeEndpoints } from '../lib/routes';
import type { RoutePoint } from '../types';

// Brand orange and ink, as in layers.ts (`--accent` and `--ink`).
const ORANGE = '#c1502e';
const INK = '#222222';

/** A white disc with an orange ring and a play arrow: where the route starts. */
const START_SVG = `<svg width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true" focusable="false">
  <circle r="13" cy="1.5" fill="#000" opacity=".14"/>
  <circle r="11" fill="#fff" stroke="${ORANGE}" stroke-width="3.5"/>
  <path d="M-3.5 -5.5 5.5 0 -3.5 5.5z" fill="${ORANGE}"/>
</svg>`;

/** A chequered flag on a pole whose base (the SVG's origin) is the exact finish point. */
const FINISH_SVG = `<svg width="28" height="38" viewBox="-5 -35 28 38" aria-hidden="true" focusable="false">
  <path d="M0 0V-30" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>
  <path d="M0 0V-30" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
  <rect x="0" y="-30" width="20" height="14" fill="#fff" stroke="#fff" stroke-width="3"/>
  <path d="M0 -30h5v4.67H0zM10 -30h5v4.67h-5zM5 -25.33h5v4.67H5zM15 -25.33h5v4.67h-5zM0 -20.67h5v4.67H0zM10 -20.67h5v4.67h-5z" fill="${INK}"/>
  <rect x="0" y="-30" width="20" height="14" fill="none" stroke="${INK}" stroke-width=".8"/>
  <circle r="3.5" fill="${INK}" stroke="#fff" stroke-width="1.5"/>
</svg>`;

/** The same disc with a circular arrow: a route that ends where it began. */
const LOOP_SVG = `<svg width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true" focusable="false">
  <circle r="13" cy="1.5" fill="#000" opacity=".14"/>
  <circle r="11" fill="#fff" stroke="${ORANGE}" stroke-width="3.5"/>
  <path d="M-5 -1a6 6 0 1 1 1.8 4.6" fill="none" stroke="${ORANGE}" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M-9 -3l4 4 2.6-5z" fill="${ORANGE}"/>
</svg>`;

function markerFor(svg: string, kind: 'start' | 'finish' | 'loop'): Marker {
  const el = document.createElement('div');
  el.className = `route-end route-end-${kind}`;
  el.setAttribute('aria-hidden', 'true');
  el.append(parseSvg(svg));
  return kind === 'finish'
    // The flag's pole base is 5 px in from its left edge and 3 px up from its bottom.
    ? new Marker({ element: el, anchor: 'bottom-left', offset: [-5, 3] })
    : new Marker({ element: el, anchor: 'center' });
}

/**
 * The start and finish of one route: a ring with a play arrow and a chequered
 * flag, or a single loop marker when the route ends where it began. There are
 * three markers in all, made once and moved, never one per route. They are
 * decoration (`pointer-events: none`), drawn above the route pins.
 */
export class RouteEndpointMarkers {
  private readonly map: MlMap;
  private readonly start = markerFor(START_SVG, 'start');
  private readonly finish = markerFor(FINISH_SVG, 'finish');
  private readonly loop = markerFor(LOOP_SVG, 'loop');

  constructor(map: MlMap) {
    this.map = map;
  }

  /** Mark this route's ends, or clear the markers when there is no route. */
  show(coordinates: readonly RoutePoint[] | null | undefined): void {
    const ends = routeEndpoints(coordinates);
    if (!ends) {
      this.remove();
      return;
    }
    if (ends.isLoop) {
      this.place(this.loop, ends.start);
      this.start.remove();
      this.finish.remove();
    } else {
      this.place(this.start, ends.start);
      this.place(this.finish, ends.finish);
      this.loop.remove();
    }
  }

  remove(): void {
    this.start.remove();
    this.finish.remove();
    this.loop.remove();
  }

  private place(marker: Marker, lngLat: [number, number]): void {
    marker.setLngLat(lngLat);
    if (marker.getElement().parentElement !== this.map.getCanvasContainer()) marker.addTo(this.map);
  }
}

/** The marker artwork as markup at another size, for the legend in the route panel. */
export function endpointIconMarkup(kind: 'start' | 'finish' | 'loop', size: number): string {
  const svg = kind === 'start' ? START_SVG : kind === 'finish' ? FINISH_SVG : LOOP_SVG;
  return svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${Math.round(kind === 'finish' ? (size * 38) / 28 : size)}"`);
}
