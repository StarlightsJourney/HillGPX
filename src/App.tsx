import { useEffect, useMemo, useState } from 'react';
import { MapView } from './map/MapView';
import { VenuePanel } from './components/VenuePanel';
import { GpxDropzone } from './components/GpxDropzone';
import { ElevationModel } from './lib/elevation';
import { loadDataset, routesForVenue, type Dataset } from './lib/venues';
import type { RoutePoint } from './types';
import { GAIN_TIERS } from './map/layers';

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [elevationModel, setElevationModel] = useState<ElevationModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [activeRouteSlug, setActiveRouteSlug] = useState<string | null>(null);
  const [droppedRoute, setDroppedRoute] = useState<RoutePoint[] | null>(null);

  useEffect(() => {
    loadDataset()
      .then(setDataset)
      .catch((err: Error) => setLoadError(err.message));

    // The terrain model is a few megabytes, so the map stays usable without it;
    // only the GPX profile degrades if it fails to load.
    ElevationModel.load()
      .then(setElevationModel)
      .catch((err: Error) => console.warn('Terrain model unavailable:', err.message));
  }, []);

  const selectedVenue = selectedSlug ? dataset?.bySlug.get(selectedSlug) ?? null : null;

  const venueRoutes = useMemo(
    () => (dataset && selectedVenue ? routesForVenue(dataset, selectedVenue) : []),
    [dataset, selectedVenue],
  );

  // A dropped GPX takes precedence over a stored route — it is what the user
  // just did, so it wins the map.
  const activeRoutePoints: RoutePoint[] | null = useMemo(() => {
    if (droppedRoute) return droppedRoute;
    if (!activeRouteSlug || !dataset) return null;
    return dataset.routeBySlug.get(activeRouteSlug)?.coordinates ?? null;
  }, [droppedRoute, activeRouteSlug, dataset]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Hill<span className="dot">Mapper</span>
        </h1>
        <p className="tagline small muted">Elevation gain to train on, in Singapore</p>
        <a
          className="small"
          href="https://github.com/StarlightsJourney/HillMapper"
          target="_blank"
          rel="noreferrer"
        >
          Contribute
        </a>
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
            <MapView
              venues={dataset?.venues ?? []}
              selectedSlug={selectedSlug}
              activeRoute={activeRoutePoints}
              onSelectVenue={(slug) => {
                setSelectedSlug(slug);
                setActiveRouteSlug(null);
              }}
            />
          )}
          <Legend />
        </div>

        <div className="sidebar">
          {selectedVenue ? (
            <VenuePanel
              venue={selectedVenue}
              routes={venueRoutes}
              activeRouteSlug={activeRouteSlug}
              onSelectRoute={setActiveRouteSlug}
              onClose={() => {
                setSelectedSlug(null);
                setActiveRouteSlug(null);
              }}
            />
          ) : (
            <section className="panel">
              <h2>Find a climb</h2>
              <p className="small">
                Hills and staircases are marked at every zoom. Zoom into a neighbourhood to see
                individual HDB blocks, coloured by how much climbing they offer. Click anything to
                see its routes.
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
