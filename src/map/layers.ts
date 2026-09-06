import type { Map as MlMap, ExpressionSpecification, GeoJSONSource } from 'maplibre-gl';
import type { Venue, VenueType } from '../types';
import { effectiveGain } from '../lib/venues';

/**
 * Map layer construction.
 *
 * The central problem this file solves: there are ~13,000 HDB blocks and about a
 * dozen hills, and the hills must not drown. So the two are drawn as separate
 * layers with different rules — landmarks (hills, stairs, parks) carry an icon
 * and are visible at every zoom because they are the things people navigate by,
 * while HDB blocks are plain dots that only appear once you have zoomed into a
 * neighbourhood.
 */

export const HDB_MIN_ZOOM = 13.5;

/** Colour ramp over metres of elevation gain. */
export const GAIN_TIERS: { min: number; color: string; label: string }[] = [
  { min: 0, color: '#4a90d9', label: 'Under 30 m' },
  { min: 30, color: '#38a58a', label: '30–60 m' },
  { min: 60, color: '#e8913a', label: '60–90 m' },
  { min: 90, color: '#d9534f', label: '90–120 m' },
  { min: 120, color: '#8e5bd0', label: '120 m and up' },
];

export function gainColor(gainM: number | null): string {
  if (gainM == null) return '#9aa0a6';
  let color = GAIN_TIERS[0].color;
  for (const tier of GAIN_TIERS) if (gainM >= tier.min) color = tier.color;
  return color;
}

const LANDMARK_TYPES: VenueType[] = ['hill', 'stairs', 'park'];

export function isLandmark(venue: Venue): boolean {
  return LANDMARK_TYPES.includes(venue.type);
}

export function venuesToGeoJson(venues: Venue[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: venues.map((v) => {
      const gain = effectiveGain(v);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [v.lng, v.lat] },
        // MapLibre warns on null-valued properties, so unknowns are encoded as
        // -1 rather than omitted — the layers never read gainM directly, but
        // queryRenderedFeatures does, and a consistent shape keeps that simple.
        properties: {
          slug: v.slug,
          name: v.name,
          venueType: v.type,
          gainM: gain ?? -1,
          color: gainColor(gain),
          icon: `venue-${v.type}`,
          storeys: v.storeys ?? -1,
          hasRoutes: v.routeSlugs.length > 0,
        },
      };
    }),
  };
}

/**
 * Icons are drawn in code rather than shipped as a sprite sheet, so a
 * contributor can restyle them without opening a graphics editor and without
 * a build step to regenerate the sprite.
 */
const ICON_SVG: Record<VenueType, string> = {
  // A mountain. The thing you asked for: Bukit Timah reads as a peak, not a dot.
  hill: `<path d="M4 26 L14 8 L20 18 L24 12 L32 26 Z" fill="currentColor"/>
         <path d="M11 13.5 L14 8 L17 13.5 L14.6 12.6 L13 14 Z" fill="#ffffff" opacity="0.9"/>`,
  stairs: `<path d="M5 27 h7 v-6 h7 v-6 h7 v-6 h4 v4 h-7 v6 h-7 v6 h-7 v6 h-4 z" fill="currentColor"/>`,
  park: `<path d="M18 27 h-2 v-6 h4 v6 z" fill="currentColor"/>
         <path d="M18 5 L27 20 H9 Z" fill="currentColor"/>`,
  hdb_block: `<rect x="10" y="6" width="12" height="21" rx="1.5" fill="currentColor"/>
              <g fill="#ffffff" opacity="0.85">
                <rect x="12.5" y="9" width="3" height="3"/><rect x="17" y="9" width="3" height="3"/>
                <rect x="12.5" y="14" width="3" height="3"/><rect x="17" y="14" width="3" height="3"/>
                <rect x="12.5" y="19" width="3" height="3"/><rect x="17" y="19" width="3" height="3"/>
              </g>`,
  carpark: `<rect x="7" y="7" width="18" height="18" rx="3" fill="currentColor"/>
            <text x="16" y="22" font-family="system-ui,sans-serif" font-size="15" font-weight="700"
                  text-anchor="middle" fill="#ffffff">P</text>`,
  bridge: `<path d="M4 20 q12 -12 24 0" stroke="currentColor" stroke-width="3" fill="none"/>
           <path d="M4 20 v6 M28 20 v6 M16 14 v12" stroke="currentColor" stroke-width="2.5" fill="none"/>`,
};

function iconSvg(type: VenueType, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <circle cx="16" cy="16" r="15" fill="#ffffff" stroke="${color}" stroke-width="2"/>
    <g color="${color}">${ICON_SVG[type]}</g>
  </svg>`;
}

/** Register one icon image per venue type. Must complete before layers are added. */
export async function loadVenueIcons(map: MlMap): Promise<void> {
  const types = Object.keys(ICON_SVG) as VenueType[];

  await Promise.all(
    types.map(async (type) => {
      const id = `venue-${type}`;
      if (map.hasImage(id)) return;

      // Landmarks get the accent colour of their tier at render time; the icon
      // itself is drawn once in a neutral ink so it stays legible on any basemap.
      const svg = iconSvg(type, type === 'hdb_block' ? '#4a90d9' : '#2f6f4f');
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

      const image = new Image(64, 64);
      image.decoding = 'sync';
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(`Failed to rasterise icon ${id}`));
        image.src = url;
      });

      if (!map.hasImage(id)) map.addImage(id, image, { pixelRatio: 2 });
    }),
  );
}

/** Dot size grows with zoom so blocks stay tappable without crowding. */
const HDB_RADIUS: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  HDB_MIN_ZOOM,
  3,
  16,
  6,
  18,
  9,
];

export function addVenueLayers(map: MlMap, data: GeoJSON.FeatureCollection): void {
  map.addSource('venues', { type: 'geojson', data });

  // HDB blocks: plain dots, zoom-gated. Drawn first so landmarks sit above them.
  map.addLayer({
    id: 'venues-hdb',
    type: 'circle',
    source: 'venues',
    filter: ['==', ['get', 'venueType'], 'hdb_block'],
    minzoom: HDB_MIN_ZOOM,
    paint: {
      'circle-radius': HDB_RADIUS,
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.9,
    },
  });

  // Landmarks: always visible, always iconed.
  map.addLayer({
    id: 'venues-landmark',
    type: 'symbol',
    source: 'venues',
    filter: ['!=', ['get', 'venueType'], 'hdb_block'],
    layout: {
      'icon-image': ['get', 'icon'],
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 0.75, 17, 1],
      'icon-allow-overlap': true,
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-offset': [0, 1.4],
      'text-anchor': 'top',
      'text-optional': true,
      // Names only once there is room for them.
      'text-max-width': 9,
    },
    paint: {
      'text-color': '#1c2b23',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.6,
    },
    minzoom: 0,
  });

  // Selection ring, driven by a filter rather than a second source.
  map.addLayer({
    id: 'venues-selected',
    type: 'circle',
    source: 'venues',
    filter: ['==', ['get', 'slug'], '__none__'],
    paint: {
      'circle-radius': 16,
      'circle-color': 'transparent',
      'circle-stroke-width': 3,
      'circle-stroke-color': '#111827',
      'circle-opacity': 0,
    },
  });
}

export function setSelectedVenue(map: MlMap, slug: string | null): void {
  if (!map.getLayer('venues-selected')) return;
  map.setFilter('venues-selected', ['==', ['get', 'slug'], slug ?? '__none__']);
}

export function addRouteLayers(map: MlMap): void {
  map.addSource('active-route', {
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
    paint: { 'line-color': '#d9534f', 'line-width': 3.5 },
  });
}

export function setActiveRoute(map: MlMap, coordinates: [number, number, number][] | null): void {
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
