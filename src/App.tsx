import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Landing } from './components/Landing';
import { VenuePanel } from './components/VenuePanel';
import { GpxDropzone } from './components/GpxDropzone';
import { ElevationModel } from './lib/elevation';
import { loadDataset, routesForVenue, type Dataset } from './lib/venues';
import type { RoutePoint } from './types';
import { GAIN_TIERS, HDB_MIN_ZOOM } from './map/layers';

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

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [activeRouteSlug, setActiveRouteSlug] = useState<string | null>(null);
  const [droppedRoute, setDroppedRoute] = useState<RoutePoint[] | null>(null);
  const [zoom, setZoom] = useState(12);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    loadDataset()
      .then(setDataset)
      .catch((err: Error) => setLoadError(err.message));

    // The terrain model is a few megabytes and only the GPX profile needs it,
    // so the map stays fully usable while it loads — or if it never does.
    ElevationModel.load()
      .then(setElevationModel)
      .catch((err: Error) => console.warn('Terrain model unavailable:', err.message));
  }, []);

  const selectedVenue = selectedSlug ? dataset?.bySlug.get(selectedSlug) ?? null : null;

  const venueRoutes = useMemo(
    () => (dataset && selectedVenue ? routesForVenue(dataset, selectedVenue) : []),
    [dataset, selectedVenue],
  );

  // A dropped GPX wins the map over a stored route — it is what the user just did.
  const activeRoutePoints: RoutePoint[] | null = useMemo(() => {
    if (droppedRoute) return droppedRoute;
    if (!activeRouteSlug || !dataset) return null;
    return dataset.routeBySlug.get(activeRouteSlug)?.coordinates ?? null;
  }, [droppedRoute, activeRouteSlug, dataset]);

  const handleSelectVenue = useCallback((slug: string | null) => {
    setSelectedSlug(slug);
    setActiveRouteSlug(null);
    // On a phone the panel is a bottom sheet; picking something should raise it.
    if (slug) setSheetOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setSelectedSlug(null);
    setActiveRouteSlug(null);
    setSheetOpen(false);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <a className="wordmark" href="#">
          hill<span className="dot">GPX</span>
        </a>
        <button
          className="sheet-toggle small"
          onClick={() => setSheetOpen((v) => !v)}
          aria-expanded={sheetOpen}
        >
          {sheetOpen ? 'Hide' : 'Details'}
        </button>
      </header>

      <main className="layout">
        <div className="map-wrap">
          {loadError ? (
            <div className="empty">
              <h2>No data yet</h2>
              <p className="small">{loadError}</p>
              <pre>
                <code>python scripts/build_data.py</code>
              </pre>
            </div>
          ) : (
            <Suspense fallback={<div className="empty small muted">Loading map…</div>}>
              <MapView
                venues={dataset?.venues ?? []}
                selectedSlug={selectedSlug}
                activeRoute={activeRoutePoints}
                onSelectVenue={handleSelectVenue}
                onZoomChange={setZoom}
              />
            </Suspense>
          )}

          {zoom < HDB_MIN_ZOOM && <div className="zoom-hint small">Zoom in for HDB blocks</div>}
          <Legend />
        </div>

        <div className={`sidebar${sheetOpen ? ' open' : ''}`}>
          <button
            className="sheet-grip"
            onClick={() => setSheetOpen((v) => !v)}
            aria-label="Toggle details panel"
          />

          {selectedVenue ? (
            <VenuePanel
              venue={selectedVenue}
              routes={venueRoutes}
              activeRouteSlug={activeRouteSlug}
              onSelectRoute={setActiveRouteSlug}
              onClose={closePanel}
            />
          ) : (
            <section className="panel">
              <h2>Find a climb</h2>
              <p className="small">
                Hills and staircases are marked at every zoom. Zoom in for individual HDB blocks,
                coloured by how much climbing they offer. Tap anything to see its routes.
              </p>
            </section>
          )}

          <GpxDropzone elevationModel={elevationModel} onRouteLoaded={setDroppedRoute} />
        </div>
      </main>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span className="small muted">Elevation gain</span>
      {GAIN_TIERS.map((tier) => (
        <span key={tier.min} className="legend-item small">
          <i style={{ background: tier.color }} />
          {tier.label}
        </span>
      ))}
    </div>
  );
}
