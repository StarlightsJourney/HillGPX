import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Route, RoutePoint, Venue } from '../types';
import { venueHeight, type Bounds } from '../lib/venues';
import { useUnits } from '../components/UnitsContext';
import { VenueCard } from '../components/VenueCard';
import {
  add3dBuildings,
  addRouteLayers,
  addVenueLayers,
  set3dBuildings,
  setActiveRoute,
  setHoveredVenue,
  setSelectedVenue,
  setVisitedVenues,
  setVisibleMarkers,
  venuesToGeoJson,
  loadMarkerImages,
  MARKER_COLS,
  MARKER_ROWS,
} from './layers';

/**
 * Basemap tiles come from OpenFreeMap, which is free to use and needs no API
 * key or account. That is what lets someone clone this repo and have a working
 * map immediately — please keep it that way when swapping styles.
 */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/**
 * The layers a click can land on. `venues-selected` is in the list because the
 * selected pill is drawn on top of its own plain one and would otherwise
 * swallow the click meant to reopen it. Naming a layer that does not exist
 * makes `queryRenderedFeatures` throw, so this is kept in one place rather
 * than repeated at each call site.
 */
const INTERACTIVE_LAYERS = ['venues-pill', 'venues-visited', 'venues-selected'];

/** Where the data currently is — the opening view, not a fence. */
const SINGAPORE_CENTRE: [number, number] = [103.8198, 1.3521];

function addUserLocationSource(map: MlMap) {
  map.addSource('user-location', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'user-location-dot',
    type: 'circle',
    source: 'user-location',
    paint: {
      'circle-radius': 8,
      'circle-color': '#1e90ff',
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#ffffff',
    },
  });
}

function userLocationFeature(lng: number, lat: number) {
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [lng, lat] },
        properties: {},
      },
    ],
  };
}

interface MapViewProps {
  venues: Venue[];
  selectedSlug: string | null;
  selectedVenue: Venue | null;
  routes: Route[];
  activeRouteSlug: string | null;
  onSelectRoute: (slug: string | null) => void;
  activeRoute: RoutePoint[] | null;
  onSelectVenue: (slug: string | null) => void;
  onOpenDetail?: () => void;
  hoveredSlug?: string | null;
  onHover?: (slug: string | null) => void;
  /**
   * Where to fly the camera. Carries a nonce so that picking the same venue
   * twice still re-centres the map rather than being skipped as unchanged.
   */
  focus?: { lng: number; lat: number; nonce: number } | null;
  /**
   * A box to frame, for a search that resolved to a whole area rather than to
   * one venue. Separate from `focus` rather than a union with it because a town
   * has no single sensible centre-and-zoom: Woodlands and Bukit Timah differ by
   * more than a zoom level, and picking one number for both would either crop a
   * town or show mostly Johor. Nonced for the same reason `focus` is.
   */
  focusBounds?: { bounds: Bounds; nonce: number } | null;
  /** Extruded buildings on/off. Also pitches the camera, since flat 3D is pointless. */
  show3d?: boolean;
  onToggle3d?: () => void;
  /** Raised when the basemap itself fails, so the failure is never silent. */
  onMapError?: (message: string) => void;
  /** The area currently on screen, so the list can show what is actually in view. */
  onViewportChange?: (
    bounds: { west: number; south: number; east: number; north: number },
    /**
     * True only when a person panned or zoomed. A programmatic flyTo — from
     * search, say — also ends in 'moveend', and treating that as a user gesture
     * would deselect the very venue that was just picked.
     */
    userInitiated: boolean,
  ) => void;
  /** The user's current location, shown as a blue dot when available. */
  userLocation?: { lng: number; lat: number } | null;
}

function boundsMeaningfullyChanged(
  prev: { west: number; south: number; east: number; north: number } | null,
  next: { west: number; south: number; east: number; north: number },
): boolean {
  if (!prev) return true;
  const tolX = Math.abs(next.east - next.west) * 0.1;
  const tolY = Math.abs(next.north - next.south) * 0.1;
  return (
    Math.abs(prev.west - next.west) > tolX ||
    Math.abs(prev.east - next.east) > tolX ||
    Math.abs(prev.north - next.north) > tolY ||
    Math.abs(prev.south - next.south) > tolY
  );
}

function sortedSlugs(slugs: string[]): string[] {
  return slugs.slice().sort();
}

function slugsEqual(a: string[] | null, b: string[]): boolean {
  if (a == null || a.length !== b.length) return false;
  const as = sortedSlugs(a);
  const bs = sortedSlugs(b);
  return as.every((s, i) => s === bs[i]);
}

export function panToShowCard(map: MlMap) {
  const container = map.getContainer();
  const popupEl = container.querySelector('.maplibregl-popup') as HTMLElement | null;
  if (!popupEl) return;

  const mapRect = container.getBoundingClientRect();
  const popupRect = popupEl.getBoundingClientRect();
  const pad = { top: 80, right: 24, bottom: 24, left: 24 };
  const maxR = mapRect.right - pad.right;
  const maxB = mapRect.bottom - pad.bottom;

  let dx = 0;
  let dy = 0;
  if (popupRect.left < mapRect.left + pad.left) dx = popupRect.left - (mapRect.left + pad.left);
  if (popupRect.right > maxR) dx = popupRect.right - maxR;
  if (popupRect.top < mapRect.top + pad.top) dy = popupRect.top - (mapRect.top + pad.top);
  if (popupRect.bottom > maxB) dy = popupRect.bottom - maxB;

  if (dx !== 0 || dy !== 0) {
    map.panBy([dx, dy], { duration: 350, essential: true });
  }
}

function flyToVenue(map: MlMap, center: maplibregl.LngLatLike) {
  map.flyTo({
    center,
    duration: 900,
    essential: true,
    // Keep the current zoom and just pad the camera so the popup has room to
    // open above the marker rather than forcing the user into street level.
    padding: { top: 220, bottom: 64, left: 64, right: 64 },
  });
  map.once('moveend', () => panToShowCard(map));
}

class ThreeDControl {
  private button: HTMLButtonElement | null = null;
  private active: boolean;
  private onClick: () => void;

  constructor(active: boolean, onClick: () => void) {
    this.active = active;
    this.onClick = onClick;
  }

  onAdd(_map: MlMap): HTMLElement {
    const group = document.createElement('div');
    group.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'maplibregl-ctrl-icon';
    this.button.title = 'Tilt the map and raise the buildings';
    this.button.setAttribute('aria-pressed', String(this.active));
    this.button.textContent = '3D';
    this.button.style.fontSize = '10px';
    this.button.style.fontWeight = '700';
    this.button.style.letterSpacing = '-0.02em';
    this.button.addEventListener('click', () => this.onClick());

    this.update(this.active);
    group.appendChild(this.button);
    return group;
  }

  onRemove(): void {
    this.button?.parentElement?.remove();
    this.button = null;
  }

  update(active: boolean): void {
    this.active = active;
    if (!this.button) return;
    this.button.setAttribute('aria-pressed', String(active));
    this.button.style.background = active ? '#222222' : 'transparent';
    this.button.style.color = active ? '#ffffff' : 'inherit';
  }
}

export function MapView({
  venues,
  selectedSlug,
  selectedVenue,
  routes,
  activeRouteSlug,
  onSelectRoute,
  activeRoute,
  onSelectVenue,
  onOpenDetail,
  hoveredSlug,
  onHover,
  focus,
  focusBounds,
  show3d = false,
  onToggle3d,
  onMapError,
  onViewportChange,
  userLocation,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const { units } = useUnits();
  const unitsRef = useRef(units);
  unitsRef.current = units;

  const [busy, setBusy] = useState(false);
  const refreshMarkersRef = useRef<(force?: boolean) => void>(() => {});
  const onSelectRef = useRef(onSelectVenue);
  onSelectRef.current = onSelectVenue;
  const venuesRef = useRef(venues);
  venuesRef.current = venues;
  const selectedRef = useRef(selectedSlug);
  selectedRef.current = selectedSlug;
  const onMapErrorRef = useRef(onMapError);
  onMapErrorRef.current = onMapError;
  const userLocationRef = useRef(userLocation);
  userLocationRef.current = userLocation;
  const show3dRef = useRef(show3d);
  show3dRef.current = show3d;
  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const lastHoverSentRef = useRef(hoveredSlug ?? null);
  lastHoverSentRef.current = hoveredSlug ?? null;
  const pendingTargetRef = useRef(hoveredSlug ?? null);
  pendingTargetRef.current = hoveredSlug ?? null;
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visitedRef = useRef(new Set<string>());
  const onToggle3dRef = useRef(onToggle3d);
  onToggle3dRef.current = onToggle3d;
  const threeDControlRef = useRef<ThreeDControl | null>(null);

  // Stabilise the visible marker set: only re-filter when the viewport has
  // moved enough to change the shortlist. Constant `setFilter` calls while a
  // user is panning are what makes the pills flicker. The viewport and marker
  // bounds are tracked separately, because `reportViewport` and `refreshMarkers`
  // both run on `moveend` and should not step on each other.
  const viewportBoundsRef = useRef<{ west: number; south: number; east: number; north: number } | null>(null);
  const markerBoundsRef = useRef<{ west: number; south: number; east: number; north: number } | null>(null);
  const lastSlugsRef = useRef<string[] | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: SINGAPORE_CENTRE,
      zoom: 12,
      minZoom: 2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const collapseAttribution = () => {
      const el = map.getContainer().querySelector('.maplibregl-ctrl-attrib');
      if (el instanceof HTMLDetailsElement) el.open = false;
      el?.classList.remove('maplibregl-compact-show');
    };
    collapseAttribution();
    map.on('load', collapseAttribution);

    if (import.meta.env.DEV) (window as unknown as { map: MlMap }).map = map;

    map.on('error', (e) => {
      const message = (e as unknown as { error?: Error }).error?.message ?? 'Unknown map error';
      console.error('[map]', message);
      onMapErrorRef.current?.(message);
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
      }),
      'top-right',
    );

    threeDControlRef.current = new ThreeDControl(show3dRef.current, () => onToggle3dRef.current?.());
    map.addControl(threeDControlRef.current, 'top-right');

    map.on('load', async () => {
      try {
        await loadMarkerImages(map);
      } catch (err) {
        if (mapRef.current === map) {
          onMapErrorRef.current?.(err instanceof Error ? err.message : 'Unable to load map markers');
        }
        return;
      }
      if (mapRef.current !== map) return;

      addVenueLayers(map, venuesToGeoJson(venuesRef.current, unitsRef.current));
      addUserLocationSource(map);
      const loc = userLocationRef.current;
      if (loc) {
        (map.getSource('user-location') as GeoJSONSource).setData(userLocationFeature(loc.lng, loc.lat));
      }
      addRouteLayers(map);
      add3dBuildings(map);
      set3dBuildings(map, show3dRef.current);
      setSelectedVenue(map, selectedRef.current);
      refreshMarkersRef.current();
      setReady(true);

      const scheduleHover = (next: string | null) => {
        if (next === lastHoverSentRef.current) return;
        clearTimeout(hoverTimeoutRef.current ?? undefined);
        hoverTimeoutRef.current = setTimeout(() => {
          lastHoverSentRef.current = next;
          onHoverRef.current?.(next);
        }, 120);
      };

      map.on('mousemove', (e) => {
        const [feature] = map.queryRenderedFeatures(e.point, { layers: INTERACTIVE_LAYERS });
        const slug = feature?.properties?.slug ?? null;
        const nextSlug = typeof slug === 'string' ? slug : null;
        // Don't draw a hover pill on top of the already-selected one.
        const target = nextSlug === selectedRef.current ? null : nextSlug;
        map.getCanvas().style.cursor = target ? 'pointer' : '';
        pendingTargetRef.current = target;
        scheduleHover(target);
      });
      map.on('mouseleave', () => {
        map.getCanvas().style.cursor = '';
        pendingTargetRef.current = null;
        scheduleHover(null);
      });

      map.on('click', (e) => {
        const [feature] = map.queryRenderedFeatures(e.point, { layers: INTERACTIVE_LAYERS });
        const slug = feature?.properties?.slug ?? null;
        if (typeof slug !== 'string') {
          onSelectRef.current(null);
          return;
        }
        onSelectRef.current(slug);
        flyToVenue(map, e.lngLat);
      });
    });

    const reportViewport = (e?: { originalEvent?: unknown }) => {
      const b = map.getBounds();
      const next = {
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      };
      if (!boundsMeaningfullyChanged(viewportBoundsRef.current, next)) return;
      viewportBoundsRef.current = next;
      onViewportRef.current?.(next, Boolean(e?.originalEvent));
    };

    const refreshMarkers = (force = false) => {
      const b = map.getBounds();
      const west = b.getWest();
      const east = b.getEast();
      const south = b.getSouth();
      const north = b.getNorth();
      const spanX = east - west;
      const spanY = north - south;
      if (spanX <= 0 || spanY <= 0) {
        setVisibleMarkers(map, []);
        return;
      }

      if (!force && !boundsMeaningfullyChanged(markerBoundsRef.current, { west, south, east, north })) return;
      markerBoundsRef.current = { west, south, east, north };

      const tallestPerCell = new Map<number, { slug: string; height: number }>();
      for (const v of venuesRef.current) {
        if (v.lng < west || v.lng > east || v.lat < south || v.lat > north) continue;
        const col = Math.min(MARKER_COLS - 1, Math.floor(((v.lng - west) / spanX) * MARKER_COLS));
        const row = Math.min(MARKER_ROWS - 1, Math.floor(((north - v.lat) / spanY) * MARKER_ROWS));
        const cell = row * MARKER_COLS + col;
        const height = venueHeight(v)?.value ?? -1;
        const held = tallestPerCell.get(cell);
        if (!held || height > held.height) tallestPerCell.set(cell, { slug: v.slug, height });
      }

      const nextSlugs = [...tallestPerCell.values()].map((x) => x.slug);
      if (slugsEqual(lastSlugsRef.current, nextSlugs)) return;
      lastSlugsRef.current = nextSlugs;
      setVisibleMarkers(map, nextSlugs);
    };
    refreshMarkersRef.current = refreshMarkers;

    map.on('moveend', reportViewport);
    map.on('moveend', refreshMarkers);
    map.once('load', () => {
      reportViewport();
      refreshMarkers();
    });

    let showTimer: ReturnType<typeof setTimeout> | null = null;
    const markBusy = () => {
      if (showTimer) return;
      showTimer = setTimeout(() => {
        setBusy(true);
        showTimer = null;
      }, 280);
    };
    const markIdle = () => {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      setBusy(false);
    };
    map.on('dataloading', markBusy);
    map.on('idle', markIdle);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    const settle = setTimeout(() => map.resize(), 0);
    map.on('load', () => map.resize());

    return () => {
      clearTimeout(settle);
      if (showTimer) clearTimeout(showTimer);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('venues') as GeoJSONSource | undefined;
    source?.setData(venuesToGeoJson(venues, units));
    setSelectedVenue(map, selectedSlug);
    refreshMarkersRef.current(true);
  }, [venues, units, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSelectedVenue(map, selectedSlug);
    if (selectedSlug && !visitedRef.current.has(selectedSlug)) {
      visitedRef.current.add(selectedSlug);
      setVisitedVenues(map, [...visitedRef.current]);
    }
  }, [selectedSlug, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setHoveredVenue(map, hoveredSlug ?? null);
    clearTimeout(hoverTimeoutRef.current ?? undefined);
    lastHoverSentRef.current = hoveredSlug ?? null;
    pendingTargetRef.current = hoveredSlug ?? null;
  }, [hoveredSlug, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    set3dBuildings(map, show3d);
    threeDControlRef.current?.update(show3d);
  }, [show3d, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    flyToVenue(map, [focus.lng, focus.lat]);
  }, [focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusBounds) return;
    const { west, south, east, north } = focusBounds.bounds;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      {
        padding: { top: 180, bottom: 64, left: 64, right: 64 },
        maxZoom: 16,
        duration: 900,
        essential: true,
      },
    );
  }, [focusBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setActiveRoute(map, activeRoute);

    if (activeRoute && activeRoute.length > 1) {
      const bounds = activeRoute.reduce(
        (b, [lng, lat]) => b.extend([lng, lat]),
        new maplibregl.LngLatBounds(
          [activeRoute[0][0], activeRoute[0][1]],
          [activeRoute[0][0], activeRoute[0][1]],
        ),
      );
      map.fitBounds(bounds, { padding: { top: 220, bottom: 80, left: 80, right: 80 }, maxZoom: 16 });
    }
  }, [activeRoute, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('user-location') as GeoJSONSource | undefined;
    if (!source) return;
    const loc = userLocationRef.current;
    source.setData(loc ? userLocationFeature(loc.lng, loc.lat) : { type: 'FeatureCollection', features: [] });
  }, [userLocation, ready]);

  const closeCard = useCallback(() => onSelectVenue(null), [onSelectVenue]);

  return (
    <>
      <div ref={containerRef} className="map" />
      {busy && (
        <div className="map-busy" role="status" aria-live="polite">
          <span className="map-busy-dot" />
          <span className="map-busy-dot" />
          <span className="map-busy-dot" />
          <span className="visually-hidden">Loading the map</span>
        </div>
      )}
      {selectedVenue && mapRef.current && (
        <VenuePopup
          map={mapRef.current}
          venue={selectedVenue}
          routes={routes}
          activeRouteSlug={activeRouteSlug}
          onSelectRoute={onSelectRoute}
          onClose={closeCard}
          onOpenDetail={onOpenDetail}
        />
      )}
    </>
  );
}

/** A card anchored to the selected venue's map coordinate. */
function VenuePopup({
  map,
  venue,
  routes,
  activeRouteSlug,
  onSelectRoute,
  onClose,
  onOpenDetail,
}: {
  map: MlMap;
  venue: Venue;
  routes: Route[];
  activeRouteSlug: string | null;
  onSelectRoute: (slug: string | null) => void;
  onClose: () => void;
  onOpenDetail?: () => void;
}) {
  const [content] = useState(() => document.createElement('div'));
  const popupRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      anchor: 'bottom',
      offset: [0, -16],
      className: 'venue-popup',
      maxWidth: 'none',
    })
      .setLngLat([venue.lng, venue.lat])
      .setDOMContent(content)
      .addTo(map);
    popupRef.current = popup;
    return () => {
      popup.remove();
      popupRef.current = null;
    };
  }, [map, content]);

  useEffect(() => {
    popupRef.current?.setLngLat([venue.lng, venue.lat]);
  }, [venue.lng, venue.lat]);

  return createPortal(
    <div
      className="venue-popup-inner"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <VenueCard
        venue={venue}
        routes={routes}
        activeRouteSlug={activeRouteSlug}
        onSelectRoute={onSelectRoute}
        onClose={onClose}
        onOpenDetail={onOpenDetail}
      />
    </div>,
    content,
  );
}
