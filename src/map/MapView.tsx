import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { RoutePoint, Venue } from '../types';
import {
  add3dBuildings,
  addRouteLayers,
  addVenueLayers,
  set3dBuildings,
  loadVenueIcons,
  setActiveRoute,
  setSelectedVenue,
  venuesToGeoJson,
} from './layers';

/**
 * Basemap tiles come from OpenFreeMap, which is free to use and needs no API
 * key or account. That is what lets someone clone this repo and have a working
 * map immediately — please keep it that way when swapping styles.
 */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Where the data currently is — the opening view, not a fence. */
const SINGAPORE_CENTRE: [number, number] = [103.8198, 1.3521];

interface MapViewProps {
  venues: Venue[];
  selectedSlug: string | null;
  activeRoute: RoutePoint[] | null;
  onSelectVenue: (slug: string | null) => void;
  /** Reported so the UI can prompt to zoom in when blocks are still hidden. */
  onZoomChange?: (zoom: number) => void;
  /**
   * Where to fly the camera. Carries a nonce so that picking the same venue
   * twice still re-centres the map rather than being skipped as unchanged.
   */
  focus?: { lng: number; lat: number; nonce: number } | null;
  /** Extruded buildings on/off. Also pitches the camera, since flat 3D is pointless. */
  show3d?: boolean;
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
}

export function MapView({
  venues,
  selectedSlug,
  activeRoute,
  onSelectVenue,
  onZoomChange,
  focus,
  show3d = false,
  onMapError,
  onViewportChange,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const readyRef = useRef(false);
  // Held in refs so the one-time 'load' handler always sees current values.
  // The map finishes loading asynchronously and the dataset arrives over the
  // network, so either can land first; whichever is last applies the state.
  const onSelectRef = useRef(onSelectVenue);
  onSelectRef.current = onSelectVenue;
  const onZoomRef = useRef(onZoomChange);
  onZoomRef.current = onZoomChange;
  const venuesRef = useRef(venues);
  venuesRef.current = venues;
  const selectedRef = useRef(selectedSlug);
  selectedRef.current = selectedSlug;
  const onMapErrorRef = useRef(onMapError);
  onMapErrorRef.current = onMapError;
  const show3dRef = useRef(show3d);
  show3dRef.current = show3d;
  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: SINGAPORE_CENTRE,
      // Chosen so HDB blocks are already on screen on first paint — a map that
      // looks empty reads as broken.
      zoom: 12,
      // Deliberately not fenced to Singapore. The data is Singapore-only today,
      // but the project is meant to cover other countries, and a camera that
      // refuses to pan anywhere else makes that look impossible.
      minZoom: 2,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // Dev-only handle, so the map can be poked at from the browser console.
    if (import.meta.env.DEV) (window as unknown as { map: MlMap }).map = map;

    // Without this a failed style or blocked tile host leaves a blank rectangle
    // and nothing in the console but a warning — which is indistinguishable
    // from the app being broken. Surface it instead.
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

    map.on('load', async () => {
      await loadVenueIcons(map);
      // Seed the source with whatever has arrived by now rather than an empty
      // collection — the dataset may already have loaded while the style did.
      addVenueLayers(map, venuesToGeoJson(venuesRef.current));
      addRouteLayers(map);
      add3dBuildings(map);
      set3dBuildings(map, show3dRef.current);
      setSelectedVenue(map, selectedRef.current);
      readyRef.current = true;

      for (const layer of ['venues-hdb-pill', 'venues-landmark']) {
        map.on('click', layer, (e) => {
          const slug = e.features?.[0]?.properties?.slug;
          if (typeof slug === 'string') onSelectRef.current(slug);
        });
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      }

      // A click on empty map clears the selection.
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, {
          layers: ['venues-hdb-pill', 'venues-landmark'],
        });
        if (hits.length === 0) onSelectRef.current(null);
      });
    });

    // The map is created inside a CSS grid cell that may still be collapsed on
    // this tick, and MapLibre sizes its drawing buffer once at construction.
    // Without this the canvas can stay a few pixels wide forever — the map then
    // requests no tiles and renders blank, with no error to go on. The observer
    // also covers the sidebar collapsing at the mobile breakpoint.
    map.on('zoom', () => onZoomRef.current?.(map.getZoom()));

    // 'moveend' rather than 'move': the list only needs the settled view, and
    // recomputing it on every frame of a pan would be wasted work.
    const reportViewport = (e?: { originalEvent?: unknown }) => {
      const b = map.getBounds();
      onViewportRef.current?.(
        {
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
        },
        // MapLibre attaches originalEvent only for input-driven movement.
        Boolean(e?.originalEvent),
      );
    };
    map.on('moveend', reportViewport);
    map.once('load', () => reportViewport());

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    // The observer alone is not enough: its first callback can arrive while the
    // grid cell is still collapsed, and if the size never changes again it is
    // also the last — leaving MapLibre with a few-pixel drawing buffer that
    // requests no tiles and renders blank, with no error to go on. A timeout is
    // used rather than requestAnimationFrame because rAF does not fire while
    // the tab is hidden, which is exactly when this tends to bite.
    const settle = setTimeout(() => map.resize(), 0);
    map.on('load', () => map.resize());

    return () => {
      clearTimeout(settle);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  // Push venue data once it has loaded (and on any later change).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!readyRef.current) return; // the load handler will pick these up
    const source = map.getSource('venues') as GeoJSONSource | undefined;
    source?.setData(venuesToGeoJson(venues));
  }, [venues]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    setSelectedVenue(map, selectedSlug);
  }, [selectedSlug]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    set3dBuildings(map, show3d);
  }, [show3d]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo({
      center: [focus.lng, focus.lat],
      // Past the HDB threshold, so a searched block is actually drawn on arrival.
      zoom: Math.max(map.getZoom(), 16),
      duration: 900,
      essential: true,
    });
  }, [focus]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    setActiveRoute(map, activeRoute);

    if (activeRoute && activeRoute.length > 1) {
      const bounds = activeRoute.reduce(
        (b, [lng, lat]) => b.extend([lng, lat]),
        new maplibregl.LngLatBounds(
          [activeRoute[0][0], activeRoute[0][1]],
          [activeRoute[0][0], activeRoute[0][1]],
        ),
      );
      map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
    }
  }, [activeRoute]);

  return <div ref={containerRef} className="map" />;
}
