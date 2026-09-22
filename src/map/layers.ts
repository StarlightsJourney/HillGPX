import type { ExpressionSpecification, Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { Route, Venue } from '../types';

/** MapLibre sources and layers that remain beneath the HTML venue markers. */

/** Dots show the density of HDB blocks once you are zoomed in close enough. */
const HDB_DOT_MIN_ZOOM = 11;

/**
 * The grid the map picks its labelled markers from: the tallest venue in each
 * cell, and nothing else.
 *
 * A fixed budget rather than "as many as fit". Collision detection answers the
 * question "does this label overlap another?", which is not the question a
 * reader is asking — they want the few things here worth walking to. Left to
 * fill the screen it produced a wall of numbers that was technically
 * non-overlapping and practically unreadable.
 *
 * A grid rather than a plain top-24, because tall blocks come in estates: rank
 * the whole viewport by height and the winners are two dozen neighbours on the
 * same three streets, all fighting for the same patch of screen while the rest
 * of the city goes unlabelled. One winner per cell spends the budget across the
 * view, which is what makes the reference's map look considered.
 */
export const MARKER_COLS = 6;
export const MARKER_ROWS = 4;

export function venuesToGeoJson(venues: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: venues.map((venue) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [venue.lng, venue.lat] },
      properties: { venueType: venue.type },
    })),
  };
}

export function addVenueLayers(map: MlMap, data: GeoJSON.FeatureCollection): void {
  map.addSource('venues', {
    type: 'geojson',
    data,
    // These points are exact locations, not shapes, so there is nothing to
    // simplify and no need for a wide tile buffer. Both settings cut the work
    // done re-tiling ~12k features as the map moves.
    tolerance: 0,
    buffer: 16,
  });

  // A faint dot for every block, under the HTML markers, only once zoomed in.
  // Drawing all 10,800 dots at world zoom is wasted work and makes the first
  // pan feel heavy.
  map.addLayer({
    id: 'venues-hdb-dot',
    type: 'circle',
    source: 'venues',
    filter: ['==', ['get', 'venueType'], 'hdb_block'],
    minzoom: HDB_DOT_MIN_ZOOM,
    // Above this the labelled markers carry the information and every dot is overdraw.
    maxzoom: 15,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 13, 2, 15, 2.6],
      'circle-color': '#a0a0a0',
      // Fades out as the markers take over, so the two never fight.
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13.5, 0.45, 15, 0],
    },
  });
}

const HOT: ExpressionSpecification = [
  'any',
  ['boolean', ['feature-state', 'hover'], false],
  ['boolean', ['feature-state', 'selected'], false],
];

export function routesToGeoJson(routes: Route[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: routes
      .filter((route) => route.coordinates.length > 1)
      .map((route) => ({
        type: 'Feature' as const,
        properties: { slug: route.slug },
        geometry: { type: 'LineString' as const, coordinates: route.coordinates.map(([lng, lat]) => [lng, lat]) },
      })),
  };
}

/**
 * Every committed and saved route, always on the map. Hover and selection are
 * feature-state so moving the pointer never re-uploads geometry.
 */
export function addAllRouteLayers(map: MlMap, data: GeoJSON.FeatureCollection): void {
  map.addSource('routes', { type: 'geojson', data, promoteId: 'slug' });
  const hot = HOT;
  map.addLayer({
    id: 'routes-casing',
    type: 'line',
    source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3, 12, 6, 16, 9],
      'line-opacity': ['case', hot, 1, 0.85],
    },
  });
  map.addLayer({
    id: 'routes-line',
    type: 'line',
    source: 'routes',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#c1502e', hot, '#222222', '#3f3f3f'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, ['case', hot, 3, 1.6], 12, ['case', hot, 4.5, 2.6], 16, ['case', hot, 6, 3.5]],
      'line-opacity': ['case', hot, 1, 0.7],
    },
  });
  // A fat invisible line under the visible one, so a 2 px trace is still easy to hover and click.
  map.addLayer({
    id: 'routes-hit',
    type: 'line',
    source: 'routes',
    paint: { 'line-color': '#000000', 'line-width': 16, 'line-opacity': 0 },
  });
}

export function setRouteFeatureState(map: MlMap, slug: string | null, key: 'hover' | 'selected', previous: string | null): void {
  if (!map.getSource('routes')) return;
  if (previous && previous !== slug) map.setFeatureState({ source: 'routes', id: previous }, { [key]: false });
  if (slug) map.setFeatureState({ source: 'routes', id: slug }, { [key]: true });
}

/** How strongly routes read against the venue pills in each mode. */
export function setRouteEmphasis(map: MlMap, strong: boolean): void {
  if (!map.getLayer('routes-line')) return;
  map.setPaintProperty('routes-line', 'line-opacity', ['case', HOT, 1, strong ? 0.85 : 0.45]);
}

export function addRouteLayers(map: MlMap): void {
  map.addSource('active-route', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addSource('route-hover', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'active-route-casing',
    type: 'line',
    source: 'active-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.95 },
  });

  map.addLayer({
    id: 'active-route-line',
    type: 'line',
    source: 'active-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#c1502e', 'line-width': 5 },
  });

  map.addSource('active-route-ends', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'active-route-ends',
    type: 'circle',
    source: 'active-route-ends',
    paint: {
      'circle-radius': ['match', ['get', 'end'], 'start', 7, 5],
      'circle-color': ['match', ['get', 'end'], 'start', '#ffffff', '#222222'],
      'circle-stroke-width': ['match', ['get', 'end'], 'start', 3, 2.5],
      'circle-stroke-color': ['match', ['get', 'end'], 'start', '#222222', '#ffffff'],
    },
  });

  map.addLayer({
    id: 'route-hover-point',
    type: 'circle',
    source: 'route-hover',
    paint: {
      'circle-radius': 7,
      'circle-color': '#c1502e',
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#ffffff',
    },
  });
}

/**
 * Draw the active route on, start to finish, rather than snapping it in. The
 * reveal is the cue that tells you where the route begins and which way it
 * runs, which a static line cannot. Returns a cancel function.
 */
export function animateActiveRoute(
  map: MlMap,
  coordinates: [number, number, number][] | null,
  durationMs = 1100,
): () => void {
  const ends = map.getSource('active-route-ends') as GeoJSONSource | undefined;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!coordinates || coordinates.length < 2 || reduce) {
    setActiveRoute(map, coordinates);
    ends?.setData(endsFeature(coordinates));
    return () => {};
  }
  let frame = 0;
  const start = performance.now();
  ends?.setData(endsFeature(coordinates.slice(0, 1)));
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / durationMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const count = Math.max(2, Math.ceil(eased * coordinates.length));
    setActiveRoute(map, coordinates.slice(0, count));
    if (t < 1) frame = requestAnimationFrame(tick);
    else ends?.setData(endsFeature(coordinates));
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

function endsFeature(coordinates: [number, number, number][] | null): GeoJSON.FeatureCollection {
  if (!coordinates || coordinates.length === 0) return { type: 'FeatureCollection', features: [] };
  const point = (c: [number, number, number], end: string) => ({
    type: 'Feature' as const,
    properties: { end },
    geometry: { type: 'Point' as const, coordinates: [c[0], c[1]] },
  });
  const features = [point(coordinates[0], 'start')];
  if (coordinates.length > 1) features.unshift(point(coordinates[coordinates.length - 1], 'finish'));
  return { type: 'FeatureCollection', features };
}

export function setActiveRoute(
  map: MlMap,
  coordinates: [number, number, number][] | null,
): void {
  const source = map.getSource('active-route') as GeoJSONSource | undefined;
  if (!source) return;

  source.setData(
    coordinates && coordinates.length > 1
      ? {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: coordinates.map(([lng, lat]) => [lng, lat]),
              },
            },
          ],
        }
      : { type: 'FeatureCollection', features: [] },
  );
}

export function setRouteHover(map: MlMap, point: [number, number] | null): void {
  const source = map.getSource('route-hover') as GeoJSONSource | undefined;
  source?.setData(
    point
      ? {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } }],
        }
      : { type: 'FeatureCollection', features: [] },
  );
}
