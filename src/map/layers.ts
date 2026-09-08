import type {
  Map as MlMap,
  GeoJSONSource,
  SymbolLayerSpecification,
  ExpressionSpecification,
} from 'maplibre-gl';
import type { Venue } from '../types';
import { venueHeight } from '../lib/venues';
import { formatHeight, type Units } from '../lib/units';

/**
 * Map layer construction.
 *
 * The central problem this file solves: there are ~10,800 HDB blocks and about a
 * dozen hills, and the hills must not drown. The reference for the marker style
 * is Airbnb's price pills — one repeated shape, the height as the label, and a
 * single selected state. Drawing hills and blocks through the same layer means the
 * map sorts both by height and collision handles spacing the same way everywhere.
 */

const PILL_FILL = '#ffffff';
const PILL_VISITED_FILL = '#e5e5e5';
const PILL_VISITED_STROKE = '#717171';
const PILL_ACTIVE_FILL = '#1a1a1a';
const TEXT_INK = '#222222';
const TEXT_LIGHT = '#ffffff';

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

/** The single pill layer is filtered to this shortlist. */
const PILL_BASE_FILTER: ExpressionSpecification = ['has', 'slug'];

export function venuesToGeoJson(
  venues: Venue[],
  units: Units = 'metric',
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: venues.map((v) => {
      const height = venueHeight(v);
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
          heightM: height?.value ?? -1,
          heightLabel: height ? formatHeight(height.value, units) : v.name,
          heightKind: height?.kind ?? 'none',
          notable: Boolean(v.notable),
          storeys: v.storeys ?? -1,
          hasRoutes: v.routeSlugs.length > 0,
        },
      };
    }),
  };
}

/**
 * Load the two stretchable pill images used for every marker.
 *
 * Venue icons are no longer used: a single repeated pill (white for normal,
 * brand-coloured for selected) is closer to the Airbnb reference and less busy
 * than a mix of icons plus text labels.
 */
export async function loadMarkerImages(map: MlMap): Promise<void> {
  for (const [id, fill, shadow, stroke] of [
    ['pill', PILL_FILL, 'rgba(0, 0, 0, 0.3)', undefined],
    ['pill-visited', PILL_VISITED_FILL, 'rgba(0, 0, 0, 0.2)', PILL_VISITED_STROKE],
    ['pill-active', PILL_ACTIVE_FILL, 'rgba(0, 0, 0, 0.38)', undefined],
  ] as const) {
    if (map.hasImage(id)) continue;
    const pill = makePillImage(fill, shadow, stroke);
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
function makePillImage(fill: string, shadow: string, stroke?: string): {
  data: ImageData;
  options: { pixelRatio: number; stretchX: [number, number][]; stretchY: [number, number][]; content: [number, number, number, number] };
} | null {
  const scale = 2;
  // Padding the canvas so the drop shadow has somewhere to fall. It is not part
  // of the pill: the stretch and content boxes below are all inset past it, so
  // MapLibre never stretches the blur or lets the label wander into it.
  const pad = 5 * scale;
  const pw = 40 * scale;
  const ph = 24 * scale;
  const w = pw + pad * 2;
  const h = ph + pad * 2;
  const r = ph / 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.beginPath();
  ctx.moveTo(pad + r, pad);
  ctx.arcTo(pad + pw, pad, pad + pw, pad + ph, r);
  ctx.arcTo(pad + pw, pad + ph, pad, pad + ph, r);
  ctx.arcTo(pad, pad + ph, pad, pad, r);
  ctx.arcTo(pad, pad, pad + pw, pad, r);
  ctx.closePath();

  // Shadow instead of the hairline stroke this used to carry. A 1px grey
  // outline is what separates a pill from a light basemap, but it also flattens
  // it into the map; the reference lifts its pills off the map with a soft
  // shadow and no border at all, which is what makes them read as objects
  // sitting above the terrain rather than shapes drawn onto it.
  ctx.shadowColor = shadow;
  ctx.shadowBlur = 4 * scale;
  ctx.shadowOffsetY = 1 * scale;
  ctx.fillStyle = fill;
  ctx.fill();

  if (stroke) {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  return {
    data: ctx.getImageData(0, 0, w, h),
    options: {
      pixelRatio: scale,
      // Only the flat middle may stretch; the rounded caps must not distort,
      // and neither may the shadow padding outside them.
      stretchX: [[pad + r, pad + pw - r]],
      // A thin band at the vertical centre, NOT [pad + r, pad + ph - r]. This
      // is a capsule — the radius is half the height — so that expression
      // collapses to a zero-height region, and a zero-height stretch band makes
      // `icon-text-fit` give up and draw no icon at all: the labels still
      // render, floating with no pill behind them, and nothing is logged. One
      // row either side of the middle is all a capsule needs.
      stretchY: [[pad + ph / 2 - 1, pad + ph / 2 + 1]],
      content: [pad + r * 0.55, pad + 4 * scale, pad + pw - r * 0.55, pad + ph - 4 * scale],
    },
  };
}

const PILL_LAYOUT: SymbolLayerSpecification['layout'] = {
  'icon-image': 'pill',
  'icon-text-fit': 'both',
  'text-field': ['get', 'heightLabel'],
  // Exactly one font, no fallback. MapLibre requests a stack as a single
  // comma-joined path segment, and OpenFreeMap only serves single-font stacks:
  // 'Noto Sans Bold' returns 200, 'Noto Sans Bold,Noto Sans Regular' returns
  // 404 — and a 404 here silently drops every label on the layer while the
  // icons keep drawing. Naming a fallback is not free insurance; it is the
  // failure. Check any new face against the glyphs endpoint before using it.
  'text-font': ['Noto Sans Bold'],
  // Airbnb-style pills: visible at every zoom, small when zoomed out and a bit
  // larger up close. Overlap is allowed so a pan never leaves the shortlist
  // blank — hovering still promotes a pill to the bigger "hover" size.
  'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.78, 16, 1.08],
  'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 13.5],
  'icon-allow-overlap': true,
  'text-allow-overlap': true,
  'icon-padding': 2,
  // Tallest venues win collisions, so a zoomed-out view still shows the biggest
  // climbs rather than a random sample.
  'symbol-sort-key': ['-', 0, ['get', 'heightM']],
};

const PILL_PAINT: SymbolLayerSpecification['paint'] = {
  'text-color': TEXT_INK,
};

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

  // A faint dot for every block, under the pills, only once you are zoomed in.
  // Drawing all 10,800 dots at world zoom is wasted work and makes the first
  // pan feel heavy.
  map.addLayer({
    id: 'venues-hdb-dot',
    type: 'circle',
    source: 'venues',
    filter: ['==', ['get', 'venueType'], 'hdb_block'],
    minzoom: HDB_DOT_MIN_ZOOM,
    // Above this the pills carry the information and every dot is overdraw.
    maxzoom: 15,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 13, 2, 15, 2.6],
      'circle-color': '#a0a0a0',
      // Fades out as the pills take over, so the two never fight.
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 13.5, 0.45, 15, 0],
    },
  });

  // Every venue — hill, stairs, HDB block — rendered as the same white pill.
  // The filter starts empty and is filled by `setVisibleMarkers` once the
  // viewport settles, so the first frame is not a wall of numbers.
  map.addLayer({
    id: 'venues-pill',
    type: 'symbol',
    source: 'venues',
    filter: ['==', ['get', 'slug'], '__none__'],
    layout: PILL_LAYOUT,
    paint: PILL_PAINT,
  });

  // Venues that have been clicked before. They keep a grey pill with a clear
  // outline so you can see which ones you have already explored.
  map.addLayer({
    id: 'venues-visited',
    type: 'symbol',
    source: 'venues',
    filter: ['==', ['get', 'slug'], '__none__'],
    layout: {
      ...PILL_LAYOUT,
      'icon-image': 'pill-visited',
      'icon-allow-overlap': true,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': TEXT_INK,
    },
  });

  // Hover: a larger white pill. At low zoom a mini pill grows to full size on
  // hover; up close it pops a little above its neighbours.
  map.addLayer({
    id: 'venues-hover',
    type: 'symbol',
    source: 'venues',
    filter: ['==', ['get', 'slug'], '__none__'],
    layout: {
      ...PILL_LAYOUT,
      'icon-image': 'pill',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 1.0, 16, 1.16],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 12, 16, 14.5],
      'icon-allow-overlap': true,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': TEXT_INK,
    },
  });

  // The selected venue: a black pill on top of everything else. Airbnb shows the
  // picked listing this way, and it gives a clear "I am open" signal.
  //
  // Overlap is forced here on purpose: this is the one symbol that must never
  // lose a collision test, because the card describing it is open on screen.
  map.addLayer({
    id: 'venues-selected',
    type: 'symbol',
    source: 'venues',
    filter: ['==', ['get', 'slug'], '__none__'],
    layout: {
      ...PILL_LAYOUT,
      'icon-image': 'pill-active',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 1.0, 16, 1.18],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 13, 16, 14.5],
      'icon-allow-overlap': true,
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': TEXT_LIGHT,
    },
  });
}

/**
 * Narrow the labelled markers to a chosen shortlist of slugs.
 *
 * Passing `null` lifts the restriction, which is what happens before the first
 * camera settle — otherwise the map would paint nothing at all on load while it
 * waited for a `moveend` that has not happened yet.
 */
export function setVisibleMarkers(map: MlMap, slugs: string[] | null): void {
  const next: ExpressionSpecification =
    slugs == null
      ? PILL_BASE_FILTER
      : ['all', PILL_BASE_FILTER, ['in', ['get', 'slug'], ['literal', slugs]]];

  if (map.getLayer('venues-pill')) {
    map.setFilter('venues-pill', next);
  }
}

export function setSelectedVenue(map: MlMap, slug: string | null): void {
  if (!map.getLayer('venues-selected')) return;
  map.setFilter('venues-selected', ['==', ['get', 'slug'], slug ?? '__none__']);
}

export function setHoveredVenue(map: MlMap, slug: string | null): void {
  if (!map.getLayer('venues-hover')) return;
  map.setFilter('venues-hover', ['==', ['get', 'slug'], slug ?? '__none__']);
}

export function setVisitedVenues(map: MlMap, slugs: string[]): void {
  if (!map.getLayer('venues-visited')) return;
  map.setFilter(
    'venues-visited',
    slugs.length === 0 ? ['==', ['get', 'slug'], '__none__'] : ['in', ['get', 'slug'], ['literal', slugs]],
  );
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
    paint: { 'line-color': '#c1502e', 'line-width': 3.5 },
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
