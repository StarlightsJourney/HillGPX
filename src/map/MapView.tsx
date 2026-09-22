import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Offset } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Route, RoutePoint, Venue } from '../types';
import { rankingHeight, type Bounds } from '../lib/venues';
import { haversineM } from '../lib/elevation';
import { useUnits } from '../components/UnitsContext';
import { VenueCard } from '../components/VenueCard';
import {
  addAllRouteLayers,
  addRouteLayers,
  addVenueLayers,
  animateActiveRoute,
  routesToGeoJson,
  setRouteEmphasis,
  setRouteFeatureState,
  setRouteHover,
  venuesToGeoJson,
  MARKER_COLS,
  MARKER_ROWS,
} from './layers';
import { RouteMarkers, VenueMarkers } from './markers';
import { MAP_STYLE_URL } from './constants';

/**
 * Basemap tiles come from OpenFreeMap, which is free to use and needs no API
 * key or account. That is what lets someone clone this repo and have a working
 * map immediately — please keep it that way when swapping styles.
 */

const VENUE_POPUP_OFFSET: Offset = {
  center: [0, 0],
  top: [0, 22],
  bottom: [0, -22],
  left: [46, 0],
  right: [-46, 0],
  'top-left': [32, 18],
  'top-right': [-32, 18],
  'bottom-left': [32, -18],
  'bottom-right': [-32, -18],
};

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
  activeRoute: RoutePoint[] | null;
  onSelectVenue: (slug: string | null) => void;
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
  mapExpanded: boolean;
  injectedVenueSlugs: string[];
  hoverPoint: [number, number] | null;
  onRouteHover: (index: number | null) => void;
  routePanelOpen: boolean;
  onToggleExpand: () => void;
  favorites: Set<string>;
  onToggleFavorite: (slug: string) => void;
  onLocateHint?: (message: string | null) => void;
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
  /** Every route to draw, whatever mode the page is in. */
  allRoutes: Route[];
  /** Routes mode puts distance pills on route starts and brings the lines forward. */
  mode: 'climbs' | 'routes';
  selectedRouteSlug: string | null;
  hoveredRouteSlug: string | null;
  onSelectRoute: (slug: string | null) => void;
  onHoverRoute: (slug: string | null) => void;
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

function flyToVenue(map: MlMap, center: maplibregl.LngLatLike) {
  map.flyTo({
    center,
    duration: 900,
    essential: true,
    // Keep the current zoom and just pad the camera so the popup has room to
    // open above the marker rather than forcing the user into street level.
    padding: { top: 220, bottom: 64, left: 64, right: 64 },
  });
}

class ExpandControl {
  private button: HTMLButtonElement | null = null;
  private expanded: boolean;
  private onClick: () => void;

  constructor(expanded: boolean, onClick: () => void) {
    this.expanded = expanded;
    this.onClick = onClick;
  }

  onAdd(_map: MlMap): HTMLElement {
    const group = document.createElement('div');
    group.className = 'maplibregl-ctrl maplibregl-ctrl-group map-expand-ctrl';
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'maplibregl-ctrl-icon';
    this.button.addEventListener('click', () => this.onClick());
    this.update(this.expanded);
    group.appendChild(this.button);
    return group;
  }

  onRemove(): void {
    this.button?.parentElement?.remove();
    this.button = null;
  }

  update(expanded: boolean): void {
    this.expanded = expanded;
    if (!this.button) return;
    const label = expanded ? 'Show list' : 'Expand map';
    this.button.setAttribute('aria-label', label);
    this.button.setAttribute('aria-pressed', String(expanded));
    this.button.title = label;
    this.button.innerHTML = expanded
      ? '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 4l-5 5M11 5v4h4M4 16l5-5M9 15v-4H5"/></svg>'
      : '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4h5v5M16 4l-6 6M9 16H4v-5M4 16l6-6"/></svg>';
  }
}

export function MapView({
  venues,
  selectedSlug,
  selectedVenue,
  routes,
  activeRoute,
  onSelectVenue,
  hoveredSlug,
  onHover,
  focus,
  focusBounds,
  mapExpanded,
  onToggleExpand,
  injectedVenueSlugs,
  hoverPoint,
  onRouteHover,
  routePanelOpen,
  favorites,
  onToggleFavorite,
  onLocateHint,
  onMapError,
  onViewportChange,
  userLocation,
  allRoutes,
  mode,
  selectedRouteSlug,
  hoveredRouteSlug,
  onSelectRoute,
  onHoverRoute,
}: MapViewProps) {
  const allRoutesRef = useRef(allRoutes);
  allRoutesRef.current = allRoutes;
  const onSelectRouteRef = useRef(onSelectRoute);
  onSelectRouteRef.current = onSelectRoute;
  const onHoverRouteRef = useRef(onHoverRoute);
  onHoverRouteRef.current = onHoverRoute;
  const routeMarkersRef = useRef<RouteMarkers | null>(null);
  const prevSelectedRouteRef = useRef<string | null>(null);
  const prevHoveredRouteRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const { units } = useUnits();

  const [busy, setBusy] = useState(false);
  const markersRef = useRef<VenueMarkers | null>(null);
  const refreshMarkersRef = useRef<(force?: boolean) => void>(() => {});
  const onSelectRef = useRef(onSelectVenue);
  onSelectRef.current = onSelectVenue;
  const venuesRef = useRef(venues);
  venuesRef.current = venues;
  const venueBySlugRef = useRef(new Map(venues.map((venue) => [venue.slug, venue])));
  const selectedSlugRef = useRef(selectedSlug);
  selectedSlugRef.current = selectedSlug;
  const hoveredSlugRef = useRef(hoveredSlug ?? null);
  hoveredSlugRef.current = hoveredSlug ?? null;
  const onMapErrorRef = useRef(onMapError);
  onMapErrorRef.current = onMapError;
  const userLocationRef = useRef(userLocation);
  userLocationRef.current = userLocation;
  const injectedVenueSlugsRef = useRef(injectedVenueSlugs);
  injectedVenueSlugsRef.current = injectedVenueSlugs;
  const activeRouteRef = useRef(activeRoute);
  activeRouteRef.current = activeRoute;
  const onRouteHoverRef = useRef(onRouteHover);
  onRouteHoverRef.current = onRouteHover;
  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const visitedRef = useRef(new Set<string>());
  const onLocateHintRef = useRef(onLocateHint);
  onLocateHintRef.current = onLocateHint;
  const onToggleExpandRef = useRef(onToggleExpand);
  onToggleExpandRef.current = onToggleExpand;
  const mapExpandedRef = useRef(mapExpanded);
  mapExpandedRef.current = mapExpanded;
  const expandControlRef = useRef<ExpandControl | null>(null);

  // The viewport and marker bounds are tracked separately because list updates
  // and the 6 × 4 marker shortlist use different thresholds.
  const viewportBoundsRef = useRef<{ west: number; south: number; east: number; north: number } | null>(null);
  const markerBoundsRef = useRef<{ west: number; south: number; east: number; north: number } | null>(null);
  const lastZoomRef = useRef<number | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: SINGAPORE_CENTRE,
      zoom: 11,
      minZoom: 2,
      renderWorldCopies: false,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    let routeHoverFrame = 0;

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

    expandControlRef.current = new ExpandControl(mapExpandedRef.current, () =>
      onToggleExpandRef.current(),
    );
    map.addControl(expandControlRef.current, 'top-right');
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    });
    geolocate.on('geolocate', () => onLocateHintRef.current?.(null));
    geolocate.on('error', (e) => {
      const err = (e as unknown as { error?: GeolocationPositionError }).error;
      const code = err?.code;
      onLocateHintRef.current?.(
        code === 1
          ? 'To improve accuracy, enable location sharing in your browser settings.'
          : code === 3
            ? 'Timed out waiting for your location.'
            : 'Could not get your location.',
      );
    });
    map.addControl(geolocate, 'top-right');

    map.on('load', () => {
      if (mapRef.current !== map) return;

      addVenueLayers(map, venuesToGeoJson(venuesRef.current));
      addUserLocationSource(map);
      const loc = userLocationRef.current;
      if (loc) {
        (map.getSource('user-location') as GeoJSONSource).setData(userLocationFeature(loc.lng, loc.lat));
      }
      addAllRouteLayers(map, routesToGeoJson(allRoutesRef.current));
      addRouteLayers(map);
      markersRef.current = new VenueMarkers(map, {
        onSelect: (slug) => onSelectRef.current(slug),
        onHover: (slug) => onHoverRef.current?.(slug),
      });
      routeMarkersRef.current = new RouteMarkers(map, {
        onSelect: (slug) => onSelectRouteRef.current(slug),
        onHover: (slug) => onHoverRouteRef.current(slug),
      });
      refreshMarkersRef.current(true);
      setReady(true);

      map.on('click', (event) => {
        const hit = map.queryRenderedFeatures(event.point, { layers: ['routes-hit'] })[0];
        const slug = hit?.properties?.slug as string | undefined;
        if (slug) {
          onSelectRouteRef.current(slug);
          return;
        }
        onSelectRef.current(null);
      });
      let hoveredRoute: string | null = null;
      map.on('mousemove', 'routes-hit', (event) => {
        const slug = (event.features?.[0]?.properties?.slug as string | undefined) ?? null;
        map.getCanvas().style.cursor = slug ? 'pointer' : '';
        if (slug !== hoveredRoute) {
          hoveredRoute = slug;
          onHoverRouteRef.current(slug);
        }
      });
      map.on('mouseleave', 'routes-hit', () => {
        map.getCanvas().style.cursor = '';
        hoveredRoute = null;
        onHoverRouteRef.current(null);
      });
      map.on('mousemove', (event) => {
        cancelAnimationFrame(routeHoverFrame);
        routeHoverFrame = requestAnimationFrame(() => {
          const features = map.queryRenderedFeatures(
            [
              [event.point.x - 6, event.point.y - 6],
              [event.point.x + 6, event.point.y + 6],
            ],
            { layers: ['active-route-line'] },
          );
          const points = activeRouteRef.current;
          if (features.length === 0 || !points?.length) {
            onRouteHoverRef.current(null);
            return;
          }
          let nearest = 0;
          let distance = Infinity;
          for (let index = 0; index < points.length; index++) {
            const next = haversineM(event.lngLat.lng, event.lngLat.lat, points[index][0], points[index][1]);
            if (next < distance) {
              distance = next;
              nearest = index;
            }
          }
          onRouteHoverRef.current(nearest);
        });
      });
      map.on('mouseleave', () => onRouteHoverRef.current(null));
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
      const zoom = map.getZoom();
      const zoomingOut = lastZoomRef.current != null && zoom < lastZoomRef.current - 0.01;
      const west = b.getWest();
      const east = b.getEast();
      const south = b.getSouth();
      const north = b.getNorth();
      const spanX = east - west;
      const spanY = north - south;
      if (spanX <= 0 || spanY <= 0) {
        markersRef.current?.setVenues([]);
        lastZoomRef.current = zoom;
        return;
      }

      if (!force && !boundsMeaningfullyChanged(markerBoundsRef.current, { west, south, east, north })) return;
      markerBoundsRef.current = { west, south, east, north };

      const cellWinners = new Map<number, Venue>();
      for (const venue of venuesRef.current) {
        if (venue.lng < west || venue.lng > east || venue.lat < south || venue.lat > north) continue;
        const col = Math.min(MARKER_COLS - 1, Math.floor(((venue.lng - west) / spanX) * MARKER_COLS));
        const row = Math.min(MARKER_ROWS - 1, Math.floor(((north - venue.lat) / spanY) * MARKER_ROWS));
        const cell = row * MARKER_COLS + col;
        const held = cellWinners.get(cell);
        if (!held || rankingHeight(venue) > rankingHeight(held)) cellWinners.set(cell, venue);
      }

      const next = new Map<string, Venue>();
      for (const venue of cellWinners.values()) next.set(venue.slug, venue);
      for (const slug of [
        hoveredSlugRef.current,
        selectedSlugRef.current,
        ...injectedVenueSlugsRef.current,
      ]) {
        if (!slug) continue;
        const venue = venueBySlugRef.current.get(slug);
        if (venue) next.set(slug, venue);
      }

      // Carrying is a zoom-in continuity rule: existing ovals get room to open
      // into full pills. Zooming out starts fresh so old neighbourhood detail
      // does not accumulate over the wider view.
      const carried = zoomingOut
        ? []
        : (markersRef.current?.currentSlugs() ?? [])
            .map((slug) => venueBySlugRef.current.get(slug))
            .filter(
              (venue): venue is Venue =>
                Boolean(
                  venue &&
                    venue.lng >= west &&
                    venue.lng <= east &&
                    venue.lat >= south &&
                    venue.lat <= north &&
                    !next.has(venue.slug),
                ),
            )
            .sort((a, b) => rankingHeight(b) - rankingHeight(a));
      for (const venue of carried.slice(0, Math.max(0, 48 - next.size))) {
        next.set(venue.slug, venue);
      }

      markersRef.current?.setVenues([...next.values()]);
      markersRef.current?.layout();
      lastZoomRef.current = zoom;
    };
    refreshMarkersRef.current = refreshMarkers;

    const layoutMarkers = () => markersRef.current?.layout();
    map.on('moveend', reportViewport);
    map.on('moveend', refreshMarkers);
    map.on('moveend', layoutMarkers);
    map.on('zoomend', layoutMarkers);
    map.on('resize', layoutMarkers);
    map.once('load', () => {
      reportViewport();
      refreshMarkers();
      layoutMarkers();
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

    const observer = new ResizeObserver(() => {
      map.resize();
      map.redraw();
    });
    observer.observe(containerRef.current);
    const settle = setTimeout(() => map.resize(), 0);
    map.on('load', () => map.resize());

    return () => {
      clearTimeout(settle);
      cancelAnimationFrame(routeHoverFrame);
      if (showTimer) clearTimeout(showTimer);
      observer.disconnect();
      markersRef.current?.remove();
      markersRef.current = null;
      routeMarkersRef.current?.remove();
      routeMarkersRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource('venues') as GeoJSONSource | undefined;
    venueBySlugRef.current = new Map(venues.map((venue) => [venue.slug, venue]));
    source?.setData(venuesToGeoJson(venues));
    refreshMarkersRef.current(true);
  }, [venues, ready]);

  useEffect(() => {
    if (!ready || !markersRef.current) return;
    refreshMarkersRef.current(true);
    if (selectedSlug) visitedRef.current.add(selectedSlug);
    markersRef.current.setState({
      selected: selectedSlug,
      hovered: hoveredSlug ?? null,
      visited: visitedRef.current,
      units,
    });
    markersRef.current.layout();
  }, [selectedSlug, hoveredSlug, injectedVenueSlugs, units, ready]);

  useEffect(() => {
    expandControlRef.current?.update(mapExpanded);
  }, [mapExpanded]);

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
    (map.getSource('routes') as GeoJSONSource | undefined)?.setData(routesToGeoJson(allRoutes));
    prevSelectedRouteRef.current = null;
    prevHoveredRouteRef.current = null;
    routeMarkersRef.current?.setRoutes(mode === 'routes' ? allRoutes : [], units);
  }, [allRoutes, mode, units, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setRouteEmphasis(map, mode === 'routes');
  }, [mode, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setRouteFeatureState(map, selectedRouteSlug, 'selected', prevSelectedRouteRef.current);
    setRouteFeatureState(map, hoveredRouteSlug, 'hover', prevHoveredRouteRef.current);
    prevSelectedRouteRef.current = selectedRouteSlug;
    prevHoveredRouteRef.current = hoveredRouteSlug;
    routeMarkersRef.current?.setState(selectedRouteSlug, hoveredRouteSlug);
  }, [selectedRouteSlug, hoveredRouteSlug, allRoutes, mode, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const cancel = animateActiveRoute(map, activeRoute);

    if (activeRoute && activeRoute.length > 1) {
      const bounds = activeRoute.reduce(
        (b, [lng, lat]) => b.extend([lng, lat]),
        new maplibregl.LngLatBounds(
          [activeRoute[0][0], activeRoute[0][1]],
          [activeRoute[0][0], activeRoute[0][1]],
        ),
      );
      map.fitBounds(bounds, {
        padding: { top: 80, bottom: routePanelOpen ? 320 : 80, left: 80, right: 80 },
        maxZoom: 15,
        duration: 900,
      });
    }
    return cancel;
  }, [activeRoute, routePanelOpen, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setRouteHover(map, hoverPoint);
  }, [hoverPoint, ready]);

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
          <span className="dots" aria-hidden="true">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </span>
          <span className="visually-hidden">Loading the map</span>
        </div>
      )}
      {selectedVenue && mapRef.current && (
        <VenuePopup
          map={mapRef.current}
          venue={selectedVenue}
          routes={routes}
          onClose={closeCard}
          favorites={favorites}
          onToggleFavorite={onToggleFavorite}
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
  onClose,
  favorites,
  onToggleFavorite,
}: {
  map: MlMap;
  venue: Venue;
  routes: Route[];
  onClose: () => void;
  favorites: Set<string>;
  onToggleFavorite: (slug: string) => void;
}) {
  const [content] = useState(() => document.createElement('div'));
  const popupRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      focusAfterOpen: false,
      offset: VENUE_POPUP_OFFSET,
      className: 'venue-popup',
      maxWidth: 'none',
    })
      .setLngLat([venue.lng, venue.lat])
      .addTo(map);
    popup.setDOMContent(content);
    popupRef.current = popup;

    let frame = 0;
    const clampToMap = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        content.style.transform = '';
        const card = content.querySelector('.venue-card');
        if (!(card instanceof HTMLElement)) return;
        const cardRect = card.getBoundingClientRect();
        const mapRect = map.getContainer().getBoundingClientRect();
        const dx = cardRect.left < mapRect.left
          ? mapRect.left - cardRect.left
          : cardRect.right > mapRect.right
            ? mapRect.right - cardRect.right
            : 0;
        const dy = cardRect.top < mapRect.top
          ? mapRect.top - cardRect.top
          : cardRect.bottom > mapRect.bottom
            ? mapRect.bottom - cardRect.bottom
            : 0;
        if (dx || dy) content.style.transform = `translate(${dx}px, ${dy}px)`;
      });
    };
    map.on('move', clampToMap);
    map.on('resize', clampToMap);
    clampToMap();

    return () => {
      cancelAnimationFrame(frame);
      map.off('move', clampToMap);
      map.off('resize', clampToMap);
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
        onClose={onClose}
        isFavorite={favorites.has(venue.slug)}
        onToggleFavorite={() => onToggleFavorite(venue.slug)}
      />
    </div>,
    content,
  );
}
