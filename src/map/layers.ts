import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { Venue } from '../types';

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
    paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 },
  });

  map.addLayer({
    id: 'active-route-line',
    type: 'line',
    source: 'active-route',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#c1502e', 'line-width': 3.5 },
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
