import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Landing } from './components/Landing';
import { ResultsList } from './components/ResultsList';
import { GpxDropzone, type LoadedGpx } from './components/GpxDropzone';
import { GpxPanel } from './components/GpxPanel';
import { SearchBar } from './components/SearchBar';
import { FilterBar } from './components/FilterBar';
import { VenueDetail } from './components/VenueDetail';
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
import { CloseIcon, ListIcon, LocationArrowIcon, MapIcon, Mark } from './components/icons';
import { loadLocalRoutes, saveLocalRoutes } from './lib/localRoutes';
import { routeFromPoints } from './lib/routes';
import { logSession } from './lib/training';
import { HeaderControls } from './components/HeaderControls';
import { TrainingPanel } from './components/TrainingPanel';
import { UnitsProvider } from './components/UnitsContext';

/** One shared empty list, so "no dataset yet" is a stable reference to memo on. */
const NO_VENUES: Venue[] = [];

// MapLibre is by far the largest dependency here. Code-splitting it keeps the
// landing page down to a small bundle that paints immediately; the map is only
// fetched once someone actually opens it.
const MapView = lazy(() => import('./map/MapView').then((m) => ({ default: m.MapView })));

type View = 'landing' | 'map' | 'training';

function viewFromHash(): View {
  if (window.location.hash === '#map' || window.location.hash.startsWith('#venue/')) return 'map';
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
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('hillgpx:favorites') || '[]') as string[]),
  );
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
    localStorage.setItem('hillgpx:favorites', JSON.stringify([...favorites]));
  }, [favorites]);

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

  // A dropped GPX wins the map over a stored route — it is what you just did.
  const activeRoutePoints: RoutePoint[] | null = useMemo(() => {
    if (droppedGpx) return droppedGpx.points;
    if (!activeRouteSlug) return null;
    return (
      dataset?.routeBySlug.get(activeRouteSlug)?.coordinates ??
      localRoutes.find((route) => route.slug === activeRouteSlug)?.coordinates ??
      null
    );
  }, [droppedGpx, activeRouteSlug, dataset, localRoutes]);

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
      selectVenue(detailVenue.slug, true);
      setActiveRouteSlug(routeSlug ?? null);
    },
    [closeDetail, detailVenue, selectVenue],
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
          setMapError(`You are about ${Math.round(gapM / 1000)} km from the nearest mapped climb. hillGPX only covers Singapore and Peninsular Malaysia.`);
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
            Import GPX
          </button>

          <HeaderControls />
        </div>
      </header>

      <FilterBar
        types={venueTypes}
        visibleVenues={viewportVenues}
        filters={filters}
        onChange={setFilters}
      />

      <main className={`stage${mapExpanded ? ' map-expanded' : ''}`}>
        {/* Wide screens start split and can expand the map; small screens toggle views. */}
        <div className={`list-pane${listOpen ? ' open' : ''}`}>
          {dataset && (
            <ResultsList
              venues={venues}
              bounds={viewport}
              routeCounts={routeCounts}
              onHover={setHoveredSlug}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
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
                venues={venues}
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
                hoverPoint={gpxHoverPoint}
                onRouteHover={setGpxHoverIndex}
                routePanelOpen={Boolean(droppedGpx)}
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

        {!(selectedVenue && !listOpen) && !(droppedGpx && !listOpen) && (
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
