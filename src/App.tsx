import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Landing } from './components/Landing';
import { ResultsList } from './components/ResultsList';
import { GpxDropzone } from './components/GpxDropzone';
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
import type { RoutePoint, Venue } from './types';
import { CloseIcon, ListIcon, LocationArrowIcon } from './components/icons';
import { HeaderControls } from './components/HeaderControls';
import { UnitsProvider } from './components/UnitsContext';

/** One shared empty list, so "no dataset yet" is a stable reference to memo on. */
const NO_VENUES: Venue[] = [];

// MapLibre is by far the largest dependency here. Code-splitting it keeps the
// landing page down to a small bundle that paints immediately; the map is only
// fetched once someone actually opens it.
const MapView = lazy(() => import('./map/MapView').then((m) => ({ default: m.MapView })));

type View = 'landing' | 'map';

function viewFromHash(): View {
  return window.location.hash === '#map' ? 'map' : 'landing';
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
  const [detailOpen, setDetailOpen] = useState(false);
  const [hoveredSlug, setHoveredSlug] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('hillgpx:favorites') || '[]') as string[]),
  );
  const [droppedRoute, setDroppedRoute] = useState<RoutePoint[] | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; nonce: number } | null>(null);
  const [focusBounds, setFocusBounds] = useState<{ bounds: Bounds; nonce: number } | null>(null);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [locateHint, setLocateHint] = useState<string | null>(null);
  const [show3d, setShow3d] = useState(false);
  // Open beside the map on a wide screen, closed over it on a phone. Either
  // way it can be dismissed — previously the desktop pane ignored this entirely,
  // so its close button did nothing and the list could not be got rid of.
  const [listOpen, setListOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches,
  );
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

  useEffect(() => {
    if (selectedSlug && !venues.some((venue) => venue.slug === selectedSlug)) {
      setSelectedSlug(null);
      setActiveRouteSlug(null);
    }
  }, [venues, selectedSlug]);

  const selectedVenue = selectedSlug ? dataset?.bySlug.get(selectedSlug) ?? null : null;

  const venueRoutes = useMemo(
    () => (dataset && selectedVenue ? routesForVenue(dataset, selectedVenue) : []),
    [dataset, selectedVenue],
  );

  // A dropped GPX wins the map over a stored route — it is what you just did.
  const activeRoutePoints: RoutePoint[] | null = useMemo(() => {
    if (droppedRoute) return droppedRoute;
    if (!activeRouteSlug || !dataset) return null;
    return dataset.routeBySlug.get(activeRouteSlug)?.coordinates ?? null;
  }, [droppedRoute, activeRouteSlug, dataset]);

  const selectVenue = useCallback(
    (slug: string | null, fly = false) => {
      setSelectedSlug(slug);
      setActiveRouteSlug(null);
      setUserLocation(null);
      if (!slug) setDetailOpen(false);
      if (fly && slug) {
        const venue = dataset?.bySlug.get(slug);
        if (venue) setFocus({ lng: venue.lng, lat: venue.lat, nonce: Date.now() });
      }
      if (slug) setListOpen(false);
    },
    [dataset],
  );

  const toggleFavorite = useCallback((slug: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

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
          hill<span className="dot">GPX</span>
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
            className="ghost-btn"
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
        visibleVenues={visibleVenues}
        filters={filters}
        onChange={setFilters}
        matchCount={visibleVenues.length}
        onLocate={handleLocate}
      />

      <main className={`stage${listOpen ? ' with-list' : ''}`}>
        {/* List beside the map at desktop widths, a sheet over it on a phone —
            the split the reference uses. It is always mounted; the breakpoint
            decides whether it sits in the grid or slides up. */}
        <div className={`list-pane${listOpen ? ' open' : ''}`}>
          {dataset && (
            <ResultsList
              venues={venues}
              bounds={viewport}
              onPick={(slug) => selectVenue(slug, true)}
              onClose={() => setListOpen(false)}
              hoveredSlug={hoveredSlug}
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
            <Suspense fallback={<div className="empty small muted">Loading the map…</div>}>
              <MapView
                venues={venues}
                selectedSlug={selectedSlug}
                selectedVenue={selectedVenue}
                routes={venueRoutes}
                activeRouteSlug={activeRouteSlug}
                onSelectRoute={setActiveRouteSlug}
                activeRoute={activeRoutePoints}
                onSelectVenue={(slug) => selectVenue(slug)}
                onOpenDetail={() => setDetailOpen(true)}
                hoveredSlug={hoveredSlug}
                onHover={setHoveredSlug}
                focus={focus}
                focusBounds={focusBounds}
                show3d={show3d}
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

            <button
              className={`map-toggle${show3d ? ' on' : ''}`}
              onClick={() => setShow3d((v) => !v)}
              aria-pressed={show3d}
              title="Tilt the map and raise the buildings"
            >
              3D
            </button>

            {mapError && <div className="map-error small">The map failed to load: {mapError}</div>}

            {locateHint && (
              <div className="locate-hint">
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
                  onClick={() => setLocateHint(null)}
                >
                  <CloseIcon size={12} />
                </button>
              </div>
            )}
          </div>
        )}

        {selectedVenue && detailOpen && (
          <VenueDetail
            venue={selectedVenue}
            routes={venueRoutes}
            activeRouteSlug={activeRouteSlug}
            onSelectRoute={setActiveRouteSlug}
            onClose={() => setDetailOpen(false)}
          />
        )}

        <div className="sheet" id="gpx-panel" hidden={!gpxOpen}>
          <div className="sheet-head">
            <h2>Your GPX</h2>
            <button className="icon-btn" onClick={() => setGpxOpen(false)} aria-label="Close GPX">
              ×
            </button>
          </div>
          <GpxDropzone elevationModel={elevationModel} onRouteLoaded={setDroppedRoute} />
        </div>

        {!listOpen && !gpxOpen && (
          <button className="list-toggle" onClick={() => setListOpen(true)}>
            <ListIcon /> Show list
          </button>
        )}
      </main>
    </div>
  );
}
