import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import type { Venue, VenueType } from '../types';
import { effectiveGain } from '../lib/venues';

/**
 * Map layer construction.
 *
 * The central problem this file solves: there are ~10,800 HDB blocks and about a
 * dozen hills, and the hills must not drown. So the two are drawn as separate
 * layers with different rules — landmarks (hills, stairs, parks) carry an icon
 * and are visible at every zoom because they are the things people navigate by,
 * while HDB blocks are plain dots that only appear once you have zoomed into a
 * neighbourhood.
 */

// Low enough that blocks are already on screen at the app's default zoom. The
// first thing someone sees must include HDB blocks — an empty-looking map reads
// as broken. A circle layer handles the few thousand visible here comfortably.
export const HDB_MIN_ZOOM = 12;

/**
 * One accent, used only to mark the biggest climbs. The pill already prints the
 * number, so a five-colour ramp was a second encoding of the same fact — it
 * asked you to decode a legend to learn something the label already said, and
 * turned the map into confetti.
 */
export const BIG_CLIMB_M = 90;

export function gainColor(gainM: number | null): string {
  return gainM != null && gainM >= BIG_CLIMB_M ? '#1a2420' : '#ffffff';
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

  for (const [id, fill, stroke] of [
    ['pill', '#ffffff', '#d8d6d0'],
    ['pill-active', '#1a2420', '#1a2420'],
  ] as const) {
    if (map.hasImage(id)) continue;
    const pill = makePillImage(fill, stroke);
    if (pill) map.addImage(id, pill.data, pill.options);
  }
}

/**
 * Extruded buildings, so a block's height is something you can see rather than
 * only read. OpenMapTiles carries per-building heights in `render_height`;
 * where it has none, storey count times a nominal floor height stands in.
 */
export function add3dBuildings(map: MlMap): void {
  if (map.getLayer('buildings-3d')) return;
  if (!map.getSource('openmaptiles')) return;

  map.addLayer({
    id: 'buildings-3d',
    type: 'fill-extrusion',
    source: 'openmaptiles',
    'source-layer': 'building',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': '#b9b5ab',
      'fill-extrusion-height': [
        'coalesce',
        ['get', 'render_height'],
        ['*', ['coalesce', ['get', 'levels'], 3], 3],
      ],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.65,
    },
  });
}

export function set3dBuildings(map: MlMap, on: boolean): void {
  const layer = map.getLayer('buildings-3d');
  if (!layer) return;
  map.setLayoutProperty('buildings-3d', 'visibility', on ? 'visible' : 'none');
  map.easeTo({ pitch: on ? 55 : 0, duration: 600 });
}

/**
 * The pill behind a marker's label — the shape Airbnb uses for prices, borrowed
 * here because it shows the number itself rather than encoding it as a colour
 * you have to decode against a legend.
 *
 * Built as a stretchable image: `stretchX`/`stretchY` mark the regions MapLibre
 * may repeat, and `content` the box the label sits in, so one small bitmap
 * resizes cleanly to fit any label.
 */
function makePillImage(fill: string, stroke: string): {
  data: ImageData;
  options: { pixelRatio: number; stretchX: [number, number][]; stretchY: [number, number][]; content: [number, number, number, number] };
} | null {
  const scale = 2;
  const w = 40 * scale;
  const h = 26 * scale;
  const r = 11 * scale;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.beginPath();
  ctx.moveTo(r, 1);
  ctx.arcTo(w - 1, 1, w - 1, h - 1, r);
  ctx.arcTo(w - 1, h - 1, 1, h - 1, r);
  ctx.arcTo(1, h - 1, 1, 1, r);
  ctx.arcTo(1, 1, w - 1, 1, r);
  ctx.closePath();

  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1 * scale;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  return {
    data: ctx.getImageData(0, 0, w, h),
    options: {
      pixelRatio: scale,
      // Only the flat middle may stretch; the rounded caps must not distort.
      stretchX: [[r, w - r]],
      stretchY: [[r, h - r]],
      content: [r * 0.6, 3 * scale, w - r * 0.6, h - 3 * scale],
    },
  };
}

export function addVenueLayers(map: MlMap, data: GeoJSON.FeatureCollection): void {
  map.addSource('venues', { type: 'geojson', data });

  // Blocks are labelled pills at every zoom they appear at. Letting MapLibre's
  // collision detection thin them — rather than drawing all 10,796 as dots — is
  // what keeps the map from reading as confetti: at city zoom only the handful
  // that fit are drawn, and `symbol-sort-key` guarantees those are the biggest
  // climbs. Zooming in reveals the rest. It is the behaviour Airbnb's price
  // pins have, and it needs no density heuristic of our own.
  map.addLayer({
    id: 'venues-hdb-pill',
    type: 'symbol',
    source: 'venues',
    filter: ['==', ['get', 'venueType'], 'hdb_block'],
    minzoom: HDB_MIN_ZOOM,
    layout: {
      'icon-image': ['case', ['>=', ['get', 'gainM'], BIG_CLIMB_M], 'pill-active', 'pill'],
      'icon-text-fit': 'both',
      'text-field': ['concat', ['to-string', ['round', ['get', 'gainM']]], ' m'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11.5,
      'icon-allow-overlap': false,
      'text-allow-overlap': false,
      'icon-padding': 3,
      'symbol-sort-key': ['-', 0, ['get', 'gainM']], // tallest wins a collision
    },
    paint: {
      'text-color': ['case', ['>=', ['get', 'gainM'], BIG_CLIMB_M], '#ffffff', '#1a2420'],
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
