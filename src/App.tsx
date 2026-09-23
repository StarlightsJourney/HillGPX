import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Landing } from './components/Landing';
import { ResultsList } from './components/ResultsList';
import { GpxDropzone, type LoadedGpx } from './components/GpxDropzone';
import { GpxPanel } from './components/GpxPanel';
import { SearchBar } from './components/SearchBar';
import { FilterBar, type BrowseMode } from './components/FilterBar';
import { VenueDetail } from './components/VenueDetail';
import { RoutesList } from './components/RoutesList';
import { RoutePanel } from './components/RoutePanel';
import { NO_ROUTE_FILTERS, filterRoutes, routeBounds, type RouteFilters } from './lib/routes';
import { boundsFromHash } from './lib/regions';
import { ElevationModel } from './lib/elevation';
import {
  NO_FILTERS,
  boundsOf,
  filterVenues,
  loadDataset,
  nearest,
  presentVenueTypes,
  routesForVenue,
  tallestWithin,
  venuesInBounds,
  type Bounds,
  type Dataset,
  type VenueFilters,
} from './lib/venues';
import { haversineM } from './lib/elevation';
import type { Route, RoutePoint, Venue } from './types';
import { CloseIcon, ListIcon, LocationArrowIcon, MapIcon, Mark, UploadIcon } from './components/icons';
import { loadLocalRoutes, saveLocalRoutes } from './lib/localRoutes';
import { routeFromPoints } from './lib/routes';
import { logSession } from './lib/training';
import { HeaderControls } from './components/HeaderControls';
import { TrainingPanel } from './components/TrainingPanel';
import { UnitsProvider } from './components/UnitsContext';

/** One shared empty list, so "no dataset yet" is a stable reference to memo on. */
const NO_VENUES: Venue[] = [];
const FAVORITES_KEY = 'hillgpx:favorites';

function loadFavorites(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveFavorites(favorites: Set<string>): void {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
  } catch {
    return;
  }
}

// MapLibre is by far the largest dependency here. Code-splitting it keeps the
// landing page down to a small bundle that paints immediately; the map is only
// fetched once someone actually opens it.
const MapView = lazy(() => import('./map/MapView').then((m) => ({ default: m.MapView })));

type View = 'landing' | 'map' | 'training';

function viewFromHash(): View {
  const hash = window.location.hash;
  if (hash === '#map' || hash === '#routes' || hash.startsWith('#map/') || hash.startsWith('#venue/')) return 'map';
  if (window.location.hash === '#training') return 'training';
  return 'landing';
}

function detailSlugFromHash(): string | null {
  return window.location.hash.startsWith('#venue/')
    ? window.location.hash.slice('#venue/'.length)
    : null;
}

export default function App() {
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const sync = () => setView(viewFromHash());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  // The provider wraps both views, not just the map: the landing page prints a
  // height too, and someone who has chosen feet should not be shown metres on
  // the way back in.
  return (
    <UnitsProvider>
      {view === 'landing' ? (
        <Landing onOpen={() => (window.location.hash = '#map')} />
      ) : view === 'training' ? (
        <TrainingPanel onClose={() => (window.location.hash = '#map')} />
      ) : (
        <MapApp />
      )}
    </UnitsProvider>
  );
}

function ListSkeleton() {
  return (
    <section className="results" aria-busy="true">
      <div className="sk-line sk-heading" />
      <ul className="results-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="skeleton-card" aria-hidden="true">
            <span className="sk-thumb" />
            <span className="sk-line" />
            <span className="sk-line" />
            <span className="sk-line" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Whether a viewport change is large enough to be worth recomputing the list
 * for. A tenth of the current span in any direction is well below what would
 * visibly reorder forty results.
 */
function boundsChangedMeaningfully(
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

function MapApp() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [elevationModel, setElevationModel] = useState<ElevationModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [activeRouteSlug, setActiveRouteSlug] = useState<string | null>(null);
  const [detailSlug, setDetailSlug] = useState(detailSlugFromHash);
  const cameFromMapRef = useRef(false);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
  const [localRoutes, setLocalRoutes] = useState<Route[]>(loadLocalRoutes);
  const [droppedGpx, setDroppedGpx] = useState<LoadedGpx | null>(null);
  const [gpxHoverIndex, setGpxHoverIndex] = useState<number | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; nonce: number } | null>(null);
  const [focusBounds, setFocusBounds] = useState<{ bounds: Bounds; nonce: number } | null>(null);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [locateHint, setLocateHint] = useState<string | null>(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  // Small screens switch between full list and full map; wide screens show both.
  const [listOpen, setListOpen] = useState(true);
  const [gpxOpen, setGpxOpen] = useState(false);
  const [filters, setFilters] = useState<VenueFilters>(NO_FILTERS);
  const [mode, setMode] = useState<BrowseMode>(() =>
    window.location.hash === '#routes' || sessionStorage.getItem('hillgpx:mode') === 'routes' ? 'routes' : 'climbs',
  );
  const [routeFilters, setRouteFilters] = useState<RouteFilters>(NO_ROUTE_FILTERS);
  const [selectedRouteSlug, setSelectedRouteSlug] = useState<string | null>(null);
  const [hoveredRouteSlug, setHoveredRouteSlug] = useState<string | null>(null);
  const [routeHoverIndex, setRouteHoverIndex] = useState<number | null>(null);
  const [viewport, setViewport] = useState<
    { west: number; south: number; east: number; north: number } | null
  >(null);

  useEffect(() => {
    loadDataset()
      .then(setDataset)
      .catch((err: Error) => setLoadError(err.message));

    // A few megabytes, and only the GPX profile needs it, so the map stays
    // fully usable while it loads — or if it never does.
    ElevationModel.load()
      .then(setElevationModel)
      .catch((err: Error) => console.warn('Terrain model unavailable:', err.message));
  }, []);

  useEffect(() => {
    const syncDetail = (event: HashChangeEvent) => {
      if (event.oldURL.endsWith('#map')) cameFromMapRef.current = true;
      setDetailSlug(detailSlugFromHash());
    };
    window.addEventListener('hashchange', syncDetail);
    return () => window.removeEventListener('hashchange', syncDetail);
  }, []);

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  useEffect(() => {
    sessionStorage.setItem('hillgpx:mode', mode);
  }, [mode]);

  // A landing-page destination arrives as #map/w,s,e,n. Frame it once, then
  // tidy the hash so a refresh does not keep yanking the camera back.
  useEffect(() => {
    const bounds = boundsFromHash(window.location.hash);
    if (!bounds) return;
    setFocusBounds({ bounds, nonce: Date.now() });
    history.replaceState(null, '', '#map');
  }, []);

  const allVenues = dataset?.venues ?? NO_VENUES;

  const venueTypes = useMemo(() => presentVenueTypes(allVenues), [allVenues]);

  // One filtered list feeds the map, the list and the search box, so the chips
  // mean the same thing everywhere. Memoised on the filters object alone: this
  // component re-renders on every pan, and re-scanning ~12k venues for a
  // viewport change the filters do not care about would be pure waste.
  const venues = useMemo(() => filterVenues(allVenues, filters), [allVenues, filters]);

  const visibleVenues = useMemo(
    () => (viewport ? venuesInBounds(venues, viewport) : venues),
    [venues, viewport],
  );
  const viewportVenues = useMemo(
    () => (viewport ? venuesInBounds(allVenues, viewport) : allVenues),
    [allVenues, viewport],
  );

  useEffect(() => {
    if (selectedSlug && !venues.some((venue) => venue.slug === selectedSlug)) {
      setSelectedSlug(null);
      setActiveRouteSlug(null);
    }
  }, [venues, selectedSlug]);

  const selectedVenue = selectedSlug ? dataset?.bySlug.get(selectedSlug) ?? null : null;
  const detailVenue = detailSlug ? dataset?.bySlug.get(detailSlug) ?? null : null;

  const routesFor = useCallback(
    (venue: Venue | null) => {
      if (!venue) return [];
      const committed = dataset ? routesForVenue(dataset, venue) : [];
      return [...committed, ...localRoutes.filter((route) => route.venueSlugs.includes(venue.slug))];
    },
    [dataset, localRoutes],
  );
  const venueRoutes = useMemo(() => routesFor(selectedVenue), [routesFor, selectedVenue]);
  const detailRoutes = useMemo(() => routesFor(detailVenue), [routesFor, detailVenue]);
  const routeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of localRoutes) {
      for (const slug of route.venueSlugs) counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
    return counts;
  }, [localRoutes]);

  const allRoutes = useMemo(() => [...(dataset?.routes ?? []), ...localRoutes], [dataset, localRoutes]);
  const filteredRoutes = useMemo(() => filterRoutes(allRoutes, routeFilters), [allRoutes, routeFilters]);
  const selectedRoute = selectedRouteSlug ? allRoutes.find((route) => route.slug === selectedRouteSlug) ?? null : null;

  // A dropped GPX wins the map over a stored route — it is what you just did.
  const activeRoutePoints: RoutePoint[] | null = useMemo(() => {
    if (droppedGpx) return droppedGpx.points;
    if (selectedRoute) return selectedRoute.coordinates;
    if (!activeRouteSlug) return null;
    return allRoutes.find((route) => route.slug === activeRouteSlug)?.coordinates ?? null;
  }, [droppedGpx, selectedRoute, activeRouteSlug, allRoutes]);

  const selectRoute = useCallback((slug: string | null) => {
    setSelectedRouteSlug(slug);
    setRouteHoverIndex(null);
    if (slug) {
      setSelectedSlug(null);
      setDroppedGpx(null);
      setListOpen(false);
    }
  }, []);

  const frameRoutes = useCallback((routes: Route[]) => {
    const boxes = routes.map(routeBounds).filter((b): b is Bounds => Boolean(b));
    if (boxes.length === 0) return;
    setFocusBounds({
      bounds: {
        west: Math.min(...boxes.map((b) => b.west)),
        south: Math.min(...boxes.map((b) => b.south)),
        east: Math.max(...boxes.map((b) => b.east)),
        north: Math.max(...boxes.map((b) => b.north)),
      },
      nonce: Date.now(),
    });
  }, []);

  // A route card on the landing page hands its slug over to open straight onto it.
  useEffect(() => {
    if (!dataset) return;
    const pending = sessionStorage.getItem('hillgpx:pendingRoute');
    if (!pending) return;
    sessionStorage.removeItem('hillgpx:pendingRoute');
    if (dataset.routeBySlug.has(pending)) selectRoute(pending);
  }, [dataset, selectRoute]);

  const routeHoverPoint: [number, number] | null =
    selectedRoute && routeHoverIndex != null && selectedRoute.coordinates[routeHoverIndex]
      ? [selectedRoute.coordinates[routeHoverIndex][0], selectedRoute.coordinates[routeHoverIndex][1]]
      : null;

  const selectVenue = useCallback(
    (slug: string | null, fly = false) => {
      setSelectedSlug(slug);
      setActiveRouteSlug(null);
      setUserLocation(null);
      if (fly && slug) {
        const venue = dataset?.bySlug.get(slug);
        if (venue) setFocus({ lng: venue.lng, lat: venue.lat, nonce: Date.now() });
      }
      if (slug) setListOpen(false);
    },
    [dataset],
  );

  const closeDetail = useCallback(() => {
    if (cameFromMapRef.current) history.back();
    else window.location.hash = '#map';
  }, []);

  const showDetailOnMap = useCallback(
    (routeSlug?: string) => {
      if (!detailVenue) return;
      closeDetail();
      if (routeSlug) {
        selectRoute(routeSlug);
        return;
      }
      selectVenue(detailVenue.slug, true);
    },
    [closeDetail, detailVenue, selectVenue, selectRoute],
  );

  const toggleFavorite = useCallback((slug: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  const saveRoute = useCallback(
    (route: Route) => {
      if (localRoutes.some((saved) => saved.slug === route.slug)) return;
      const next = [...localRoutes, route];
      saveLocalRoutes(next);
      setLocalRoutes(next);
      logSession({ routeName: route.name, gainM: route.gainM, distanceM: route.distanceM });
    },
    [localRoutes],
  );

  const removeLocalRoute = useCallback(
    (slug: string) => {
      const next = localRoutes.filter((route) => route.slug !== slug);
      saveLocalRoutes(next);
      setLocalRoutes(next);
      setActiveRouteSlug((current) => (current === slug ? null : current));
    },
    [localRoutes],
  );

  const droppedRoute = useMemo(
    () => droppedGpx && routeFromPoints(droppedGpx.name, droppedGpx.points, droppedGpx.venueSlugs),
    [droppedGpx],
  );
  const gpxHoverPoint: [number, number] | null =
    droppedGpx && gpxHoverIndex != null
      ? [droppedGpx.points[gpxHoverIndex][0], droppedGpx.points[gpxHoverIndex][1]]
      : null;

  // Framing an area is a change of place, so any card still open is describing
  // somewhere you have just left. A pan already clears it; this is the same rule
  // for a move the person asked for by name.
  const showArea = useCallback((bounds: Bounds) => {
    setSelectedSlug(null);
    setActiveRouteSlug(null);
    setUserLocation(null);
    setFocusBounds({ bounds, nonce: Date.now() });
  }, []);

  const handleLocate = useCallback(() => {
    if (!navigator.geolocation || allVenues.length === 0) {
      setLocateHint('This browser does not support location sharing.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const [closest] = nearest(allVenues, longitude, latitude, 1);
        const gapM = closest ? haversineM(longitude, latitude, closest.lng, closest.lat) : Infinity;
        if (gapM > 100_000) {
          setLocateHint(`The nearest mapped climb is about ${Math.round(gapM / 1000)} km away. Know a hill near you? Add it from the menu.`);
          setUserLocation({ lng: longitude, lat: latitude });
          setFocus({ lng: longitude, lat: latitude, nonce: Date.now() });
          return;
        }
        const nearby = tallestWithin(allVenues, longitude, latitude, 2_000, 8);
        setSelectedSlug(null);
        setActiveRouteSlug(null);
        setLocateHint(null);
        setUserLocation({ lng: longitude, lat: latitude });
        const bounds = boundsOf([{ lng: longitude, lat: latitude }, ...nearby.map((n) => n.venue)]);
        if (bounds) setFocusBounds({ bounds, nonce: Date.now() });
      },
      (err) => {
        setLocateHint(
          err.code === err.PERMISSION_DENIED
            ? 'To improve accuracy, enable location sharing in your browser settings.'
            : err.code === err.TIMEOUT
              ? 'Timed out waiting for your location.'
              : 'Could not get your location.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [allVenues]);

  return (
    <div className="app">
      <header className="topbar">
        <a className="wordmark" href="#">
          <Mark size={30} />
          <span>
            hill<span className="dot">GPX</span>
          </span>
        </a>

        {/* Search runs over what is currently on screen. Finding a hill you have
            filtered out or panned away from would land you on a blank patch of
            map with nothing to click, which reads as a broken map rather than
            as a chip you left on. */}
        <SearchBar
          venues={visibleVenues}
          onPick={(slug) => selectVenue(slug, true)}
          onFitBounds={showArea}
        />

        <div className="topbar-actions">
          <button
            className="gpx-link"
            onClick={() => setGpxOpen((v) => !v)}
            aria-expanded={gpxOpen}
            aria-controls="gpx-panel"
          >
            <UploadIcon size={16} />
            <span className="hide-narrow">Import GPX</span>
          </button>

          <HeaderControls />
        </div>
      </header>

      <FilterBar
        types={venueTypes}
        visibleVenues={viewportVenues}
        filters={filters}
        onChange={setFilters}
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          setSelectedSlug(null);
          if (next === 'climbs') setSelectedRouteSlug(null);
        }}
        routes={allRoutes}
        routeFilters={routeFilters}
        onRouteFiltersChange={setRouteFilters}
      />

      <main className={`stage${mapExpanded ? ' map-expanded' : ''}`}>
        {/* Wide screens start split and can expand the map; small screens toggle views. */}
        <div className={`list-pane${listOpen ? ' open' : ''}`}>
          {!dataset && !loadError && <ListSkeleton />}
          {dataset && mode === 'climbs' && (
            <ResultsList
              venues={venues}
              bounds={viewport}
              routeCounts={routeCounts}
              onHover={setHoveredSlug}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
            />
          )}
          {dataset && mode === 'routes' && (
            <RoutesList
              routes={filteredRoutes}
              bounds={viewport}
              selectedSlug={selectedRouteSlug}
              onSelect={selectRoute}
              onHover={setHoveredRouteSlug}
              onImport={() => setGpxOpen(true)}
              onShowAll={frameRoutes}
            />
          )}
        </div>

        {loadError ? (
          <div className="empty">
            <h2>Nothing to show yet</h2>
            <p className="small muted">{loadError}</p>
            <pre>
              <code>python scripts/build_data.py</code>
            </pre>
          </div>
        ) : (
          <div className="map-wrap">
            <Suspense fallback={<div className="map-skeleton"><div className="map-skeleton-pulse" /></div>}>
              <MapView
                allRoutes={mode === 'routes' ? filteredRoutes : allRoutes}
                mode={mode}
                selectedRouteSlug={selectedRouteSlug}
                hoveredRouteSlug={hoveredRouteSlug}
                onSelectRoute={selectRoute}
                onHoverRoute={setHoveredRouteSlug}
                venues={mode === 'routes' ? NO_VENUES : venues}
                selectedSlug={selectedSlug}
                selectedVenue={selectedVenue}
                routes={venueRoutes}
                activeRoute={activeRoutePoints}
                onSelectVenue={(slug) => selectVenue(slug)}
                hoveredSlug={hoveredSlug}
                onHover={setHoveredSlug}
                focus={focus}
                focusBounds={focusBounds}
                mapExpanded={mapExpanded}
                onToggleExpand={() => setMapExpanded((value) => !value)}
                injectedVenueSlugs={droppedGpx?.venueSlugs ?? []}
                hoverPoint={gpxHoverPoint ?? routeHoverPoint}
                onRouteHover={droppedGpx ? setGpxHoverIndex : setRouteHoverIndex}
                routePanelOpen={Boolean(droppedGpx || selectedRoute)}
                favorites={favorites}
                onToggleFavorite={toggleFavorite}
                onLocateHint={setLocateHint}
                userLocation={userLocation}
                onMapError={setMapError}
                onViewportChange={(b, userInitiated) => {
                  // Every zoom or pan ends here, and a new bounds object
                  // re-runs the list's filter over ~12k venues and re-renders
                  // forty image cards. Most gestures barely change what is on
                  // screen, so ignore movements too small to alter the results.
                  setViewport((prev) => (boundsChangedMeaningfully(prev, b) ? b : prev));
                  // A card left pinned over a map you have panned away from is
                  // describing somewhere no longer on screen. Only a real pan
                  // counts — a flyTo from search must not undo its own pick.
                  if (userInitiated) selectVenue(null);
                }}
              />
            </Suspense>

            {mapError && <div className="map-error small">The map failed to load: {mapError}</div>}

            {locateHint && (
              <div className="locate-hint" onClick={handleLocate}>
                <span className="locate-hint-icon" aria-hidden="true">
                  <LocationArrowIcon size={22} />
                </span>
                <div className="locate-hint-body">
                  <p className="locate-hint-title">Share your location</p>
                  <p className="locate-hint-text">{locateHint}</p>
                </div>
                <button
                  type="button"
                  className="locate-hint-close"
                  aria-label="Dismiss location hint"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocateHint(null);
                  }}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            )}

            {!droppedGpx && selectedRoute && (
              <RoutePanel
                route={selectedRoute}
                venuesBySlug={dataset?.bySlug ?? new Map()}
                hoverIndex={routeHoverIndex}
                onHoverIndex={setRouteHoverIndex}
                onClose={() => selectRoute(null)}
              />
            )}

            {droppedGpx && droppedRoute && (
              <GpxPanel
                loaded={droppedGpx}
                venuesBySlug={dataset?.bySlug ?? new Map()}
                hoverIndex={gpxHoverIndex}
                onHoverIndex={setGpxHoverIndex}
                onClose={() => {
                  setDroppedGpx(null);
                  setGpxHoverIndex(null);
                }}
                onSave={saveRoute}
                saved={localRoutes.some((route) => route.slug === droppedRoute.slug)}
              />
            )}
          </div>
        )}

        {!(selectedVenue && !listOpen) && !((droppedGpx || selectedRoute) && !listOpen) && (
          <button type="button" className="view-toggle" onClick={() => setListOpen((v) => !v)}>
            {listOpen ? (
              <>
                Show map <MapIcon size={16} />
              </>
            ) : (
              <>
                Show list <ListIcon size={16} />
              </>
            )}
          </button>
        )}

        {detailVenue && (
          <VenueDetail
            venue={detailVenue}
            routes={detailRoutes}
            onClose={closeDetail}
            onShowOnMap={showDetailOnMap}
            isFavorite={favorites.has(detailVenue.slug)}
            onToggleFavorite={() => toggleFavorite(detailVenue.slug)}
            allVenues={allVenues}
            onRemoveLocalRoute={removeLocalRoute}
          />
        )}

        <div className="sheet" id="gpx-panel" hidden={!gpxOpen}>
          <div className="sheet-head">
            <h2>Your GPX</h2>
            <button className="icon-btn" onClick={() => setGpxOpen(false)} aria-label="Close GPX">
              ×
            </button>
          </div>
          <GpxDropzone
            elevationModel={elevationModel}
            venues={allVenues}
            onLoaded={(loaded) => {
              setDroppedGpx(loaded);
              setGpxHoverIndex(null);
              setGpxOpen(false);
              setListOpen(false);
            }}
          />
        </div>

      </main>

    </div>
  );
}
