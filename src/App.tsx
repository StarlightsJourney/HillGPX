import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Landing } from './components/Landing';
import { VenueCard } from './components/VenueCard';
import { ResultsList } from './components/ResultsList';
import { GpxDropzone } from './components/GpxDropzone';
import { SearchBar } from './components/SearchBar';
import { ElevationModel } from './lib/elevation';
import { loadDataset, routesForVenue, type Dataset } from './lib/venues';
import type { RoutePoint } from './types';
import { ListIcon } from './components/icons';

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

  if (view === 'landing') {
    return <Landing onOpen={() => (window.location.hash = '#map')} />;
  }
  return <MapApp />;
}

function MapApp() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [elevationModel, setElevationModel] = useState<ElevationModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [activeRouteSlug, setActiveRouteSlug] = useState<string | null>(null);
  const [droppedRoute, setDroppedRoute] = useState<RoutePoint[] | null>(null);
  const [focus, setFocus] = useState<{ lng: number; lat: number; nonce: number } | null>(null);
  const [show3d, setShow3d] = useState(false);
  // Open beside the map on a wide screen, closed over it on a phone. Either
  // way it can be dismissed — previously the desktop pane ignored this entirely,
  // so its close button did nothing and the list could not be got rid of.
  const [listOpen, setListOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches,
  );
  const [gpxOpen, setGpxOpen] = useState(false);
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
      if (fly && slug) {
        const venue = dataset?.bySlug.get(slug);
        if (venue) setFocus({ lng: venue.lng, lat: venue.lat, nonce: Date.now() });
      }
      if (slug) setListOpen(false);
    },
    [dataset],
  );

  return (
    <div className="app">
      <header className="topbar">
        <a className="wordmark" href="#">
          hill<span className="dot">GPX</span>
        </a>

        <SearchBar venues={dataset?.venues ?? []} onPick={(slug) => selectVenue(slug, true)} />

        <button className="ghost-btn" onClick={() => setGpxOpen((v) => !v)}>
          Your GPX
        </button>
      </header>

      <main className={`stage${listOpen ? ' with-list' : ''}`}>
        {/* List beside the map at desktop widths, a sheet over it on a phone —
            the split the reference uses. It is always mounted; the breakpoint
            decides whether it sits in the grid or slides up. */}
        <div className={`list-pane${listOpen ? ' open' : ''}`}>
          {dataset && (
            <ResultsList
              venues={dataset.venues}
              bounds={viewport}
              onPick={(slug) => selectVenue(slug, true)}
              onClose={() => setListOpen(false)}
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
                venues={dataset?.venues ?? []}
                selectedSlug={selectedSlug}
                activeRoute={activeRoutePoints}
                onSelectVenue={(slug) => selectVenue(slug)}
                focus={focus}
                show3d={show3d}
                onMapError={setMapError}
                onViewportChange={(b, userInitiated) => {
                  setViewport(b);
                  // A card left pinned over a map you have panned away from is
                  // describing somewhere no longer on screen. Only a real pan
                  // counts — a flyTo from search must not undo its own pick.
                  if (userInitiated) setSelectedSlug(null);
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
          </div>
        )}

        {/* Detail rides over the map as a card, so it never permanently eats the
            space the map is supposed to fill. */}
        {selectedVenue && (
          <VenueCard
            venue={selectedVenue}
            routes={venueRoutes}
            activeRouteSlug={activeRouteSlug}
            onSelectRoute={setActiveRouteSlug}
            onClose={() => selectVenue(null)}
          />
        )}

        {gpxOpen && (
          <div className="sheet">
            <div className="sheet-head">
              <h2>Your GPX</h2>
              <button className="icon-btn" onClick={() => setGpxOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <GpxDropzone elevationModel={elevationModel} onRouteLoaded={setDroppedRoute} />
          </div>
        )}

        {!listOpen && !gpxOpen && (
          <button className="list-toggle" onClick={() => setListOpen(true)}>
            <ListIcon /> Show list
          </button>
        )}

        {listOpen && (
          <button
            className="list-toggle list-toggle-hide"
            onClick={() => setListOpen(false)}
          >
            Show map
          </button>
        )}
      </main>
    </div>
  );
}
