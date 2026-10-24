import { memo, useMemo } from 'react';
import type { Route } from '../types';
import { routeDifficulty, routeHasElevation, routeIntersects } from '../lib/routes';
import type { Bounds } from '../lib/venues';
import { regionOf } from '../lib/regions';
import { RouteThumb } from './RouteThumb';
import { ActivityTag } from './ActivityIcon';
import { routeActivity } from '../lib/routeAnalysis';
import { useUnits } from './UnitsContext';
import { DownloadIcon, UploadIcon } from './icons';
import { downloadRoute } from './VenueCard';
import type { RouteMatch } from '../lib/routeMatch';
import { MATCH_LABEL_TEXT, describeMiss, describeReasons } from '../lib/matchText';
import { RouteBookmarkButton } from './RouteBookmarkButton';

interface RoutesListProps {
  routes: Route[];
  bounds: Bounds | null;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
  onHover: (slug: string | null) => void;
  onImport: () => void;
  onShowAll: (routes: Route[]) => void;
  /**
   * Set when the routes are ranked for a run (lib/routeMatch.ts): every
   * ranked route is listed wherever the map is, each with its match label
   * and reasons, under this heading.
   */
  ranking?: { matches: Map<string, RouteMatch>; title: string } | null;
}

/** Routes are shown in the order given: the map page decides it. */
function RoutesListInner({ routes, bounds, selectedSlug, onSelect, onHover, onImport, onShowAll, ranking = null }: RoutesListProps) {
  const units = useUnits();
  const inView = useMemo(
    () => (bounds && !ranking ? routes.filter((route) => routeIntersects(route, bounds)) : routes),
    [routes, bounds, ranking],
  );
  // A route list that goes blank the moment you pan off the two places that
  // have routes reads as broken. Fall back to everything, and say so.
  const showingAll = inView.length === 0 && routes.length > 0;
  const rows = showingAll ? routes : inView;

  return (
    <section className="results">
      <header className="results-head">
        <div>
          <h2>
            {rows.length} route{rows.length === 1 ? '' : 's'}
            {ranking ? ` ${ranking.title}` : showingAll ? ' everywhere' : ' in this area'}
          </h2>
          {showingAll && (
            <p className="results-sub">
              None cross the map right now.{' '}
              <button type="button" className="linkish" onClick={() => onShowAll(routes)}>
                Zoom to all routes
              </button>
            </p>
          )}
        </div>
      </header>

      {routes.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><UploadIcon size={24} /></div>
          <h3>No routes match</h3>
          <p>Loosen the filters, or import a GPX from your watch to see its profile here.</p>
          <button type="button" className="btn btn-dark" onClick={onImport}>Import a GPX</button>
        </div>
      ) : (
        <ul className="results-grid">
          {rows.map((route, index) => {
            const region = route.country ?? regionOf(route.coordinates[0][0], route.coordinates[0][1]);
            const match = ranking?.matches.get(route.slug);
            return (
              <li
                key={route.slug}
                className={`result-item route-item${route.slug === selectedSlug ? ' selected' : ''}`}
                style={{ '--i': index } as React.CSSProperties}
                onMouseEnter={() => onHover(route.slug)}
                onMouseLeave={() => onHover(null)}
              >
                {match ? (
                  <span className={`result-badge match-badge match-${match.label}`}>{MATCH_LABEL_TEXT[match.label]}</span>
                ) : (
                  <span className="result-badge">{routeDifficulty(route)}</span>
                )}
                <RouteBookmarkButton route={route} variant="card" />
                <button
                  type="button"
                  className="result-action"
                  aria-label={`Download ${route.name} as GPX`}
                  onClick={() => downloadRoute(route)}
                >
                  <DownloadIcon size={16} />
                </button>
                <button type="button" className="result-card" onClick={() => onSelect(route.slug)}>
                  <RouteThumb route={route} />
                  <span className="result-card-top">
                    <span className="result-card-name">{route.name}</span>
                    <ActivityTag activity={routeActivity(route)} />
                  </span>
                  <span className="result-card-meta">
                    {[region, route.loop ? 'Loop' : 'Point to point', route.source === 'local' ? 'On this device' : null]
                      .filter(Boolean)
                      .join(' · ')}
                    {route.downloads !== undefined && (
                      <span className="card-dls">
                        <DownloadIcon size={11} />
                        {route.downloads}
                      </span>
                    )}
                  </span>
                  {match ? (
                    <>
                      <span className="result-card-gain match-reasons">{describeReasons(match.reasons, units.units)}</span>
                      {match.misses.length > 0 && (
                        <span className="match-misses">{match.misses.map((miss) => describeMiss(miss, units.units)).join(' · ')}</span>
                      )}
                    </>
                  ) : (
                    <span className="result-card-gain">
                      <strong>{units.distance(route.distanceM)}</strong> · <strong>{routeHasElevation(route) ? `${units.height(route.gainM)} EG` : 'Elevation unavailable'}</strong>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export const RoutesList = memo(RoutesListInner);
