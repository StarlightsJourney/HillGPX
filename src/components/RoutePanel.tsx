import { useMemo } from 'react';
import type { Route, Venue } from '../types';
import { computeGain } from '../lib/elevation';
import { climbRate, routeDifficulty, routeHasElevation } from '../lib/routes';
import { regionOf } from '../lib/regions';
import { ElevationProfile } from './ElevationProfile';
import { TypeGlyph } from './TypeGlyph';
import { useUnits } from './UnitsContext';
import { downloadRoute } from './VenueCard';
import { CloseIcon, DownloadIcon } from './icons';

interface RoutePanelProps {
  route: Route;
  venuesBySlug: Map<string, Venue>;
  hoverIndex: number | null;
  onHoverIndex: (index: number | null) => void;
  onClose: () => void;
}

/** The selected route, docked over the bottom of the map with its profile. */
export function RoutePanel({ route, venuesBySlug, hoverIndex, onHoverIndex, onClose }: RoutePanelProps) {
  const units = useUnits();
  const { minM, maxM } = useMemo(() => computeGain(route.coordinates), [route.coordinates]);
  const hasElevation = routeHasElevation(route);
  const region = route.country ?? regionOf(route.coordinates[0][0], route.coordinates[0][1]);
  const touches = route.venueSlugs
    .map((slug) => venuesBySlug.get(slug))
    .filter((venue): venue is Venue => Boolean(venue));

  return (
    <section className="gpx-panel route-panel" aria-label={`Route: ${route.name}`} key={route.slug}>
      <header className="gpx-panel-head">
        <div className="route-panel-title">
          <p className="route-panel-kicker">
            {[region, routeDifficulty(route), route.loop ? 'Loop' : 'Point to point'].filter(Boolean).join(' · ')}
          </p>
          <h2>{route.name}</h2>
        </div>
        <div className="gpx-panel-actions">
          <button type="button" className="gpx-download" onClick={() => downloadRoute(route)}>
            <DownloadIcon size={14} />
            Download GPX
          </button>
          <button type="button" className="gpx-close" onClick={onClose} aria-label="Close route">
            <CloseIcon size={12} />
          </button>
        </div>
      </header>

      <div className="gpx-stats">
        {[
          ['Distance', units.distance(route.distanceM)],
          ['EG', hasElevation ? units.height(route.gainM) : 'Unavailable'],
          ['Descent', hasElevation ? units.height(route.lossM) : 'Unavailable'],
          ['Highest', hasElevation ? units.height(maxM) : 'Unavailable'],
          ['Lowest', hasElevation ? units.height(minM) : 'Unavailable'],
          ['EG / km', hasElevation ? units.height(climbRate(route)) : 'Unavailable'],
        ].map(([label, value]) => (
          <div className="gpx-stat" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {touches.length > 0 && (
        <div className="gpx-touches">
          <strong>Passes</strong>
          {touches.map((venue) => (
            <a key={venue.slug} href={`#venue/${venue.slug}`}>
              <TypeGlyph type={venue.type} />
              {venue.name}
            </a>
          ))}
        </div>
      )}

      {hasElevation ? (
        <ElevationProfile points={route.coordinates} height={92} hoverIndex={hoverIndex} onHoverIndex={onHoverIndex} />
      ) : (
        <p className="route-elevation-unavailable">Elevation is unavailable for this route.</p>
      )}

      {(route.contributor || route.licence || route.sourceUrl) && (
        <p className="route-credit">
          {route.contributor && <>Added by {route.contributor}. </>}
          {route.licence && <>{route.licence}. </>}
          {route.sourceUrl && (
            <a href={route.sourceUrl} target="_blank" rel="noreferrer">
              Source
            </a>
          )}
        </p>
      )}
    </section>
  );
}
