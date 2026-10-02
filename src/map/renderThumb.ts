import { Map as MapLibreMap } from 'maplibre-gl';
import type { Route } from '../types';
import { THUMB_H, THUMB_W, thumbView } from '../lib/thumbView';
import './worker';
import { MAP_STYLE_URL } from './constants';

const TERRAIN_TILES = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';

/**
 * Render a route card's basemap in the browser, exactly as
 * scripts/render_route_thumbs.ts does for committed routes: same style, same
 * camera (thumbView), labels hidden, hillshade on. The card draws the trace
 * on top, so only the terrain is captured. Returns a JPEG, or null on failure.
 */
export async function renderRouteThumb(route: Route): Promise<{ blob: Blob; key: string } | null> {
  const view = thumbView(route.coordinates);
  if (!view) return null;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${THUMB_W}px;height:${THUMB_H}px;pointer-events:none;`;
  document.body.appendChild(host);
  const map = new MapLibreMap({
    container: host,
    style: MAP_STYLE_URL,
    center: view.centre,
    zoom: view.zoom,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    pixelRatio: 2,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('timed out')), 20_000);
      map.once('style.load', () => {
        for (const layer of map.getStyle().layers) if (layer.type === 'symbol') map.setLayoutProperty(layer.id, 'visibility', 'none');
        map.addSource('thumb-terrain', { type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15, tiles: [TERRAIN_TILES] });
        const beneath = map.getStyle().layers.find((layer) => layer.type === 'line')?.id;
        map.addLayer(
          {
            id: 'thumb-hillshade',
            type: 'hillshade',
            source: 'thumb-terrain',
            paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': '#5a6b52', 'hillshade-highlight-color': '#ffffff' },
          },
          beneath,
        );
        map.once('idle', () => {
          window.clearTimeout(timer);
          resolve();
        });
      });
    });
    const blob = await new Promise<Blob | null>((resolve) => map.getCanvas().toBlob(resolve, 'image/jpeg', 0.8));
    return blob ? { blob, key: view.key } : null;
  } catch {
    return null;
  } finally {
    map.remove();
    host.remove();
  }
}
