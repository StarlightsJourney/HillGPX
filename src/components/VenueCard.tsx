import type { Route, Venue } from '../types';
import { VENUE_TYPE_LABEL, effectiveGain, formatDistance } from '../lib/venues';
import { ElevationProfile } from './ElevationProfile';
import { PhotoCredit, VenueThumb } from './VenueThumb';

const REPO_URL = 'https://github.com/StarlightsJourney/HillGPX';

interface VenueCardProps {
  venue: Venue;
  routes: Route[];
  activeRouteSlug: string | null;
  onSelectRoute: (slug: string | null) => void;
  onClose: () => void;
}

/**
 * Detail for one venue, floating over the map.
 *
 * A card rather than a fixed panel: the map is the thing people came for, and a
 * permanent column takes a third of it away whether or not anything is selected.
 * This appears when you pick something and gets out of the way when you don't.
 */
export function VenueCard({
  venue,
  routes,
  activeRouteSlug,
  onSelectRoute,
  onClose,
}: VenueCardProps) {
  const gain = effectiveGain(venue);
  const activeRoute = routes.find((r) => r.slug === activeRouteSlug) ?? null;

  return (
    <aside className="venue-card">
      <button className="icon-btn card-close" onClick={onClose} aria-label="Close">
        ×
      </button>

      <div className="card-photo">
        <VenueThumb venue={venue} rounded={false} />
      </div>

      <div className="card-body">
        <p className="card-kicker small muted">
          {VENUE_TYPE_LABEL[venue.type]}
          {venue.town && ` · ${venue.town}`}
        </p>
        <h2>{venue.name}</h2>

        <div className="card-stats">
          {gain != null ? (
            <>
              <span className="card-gain">{Math.round(gain)} m</span>
              <span className="small muted">
                of climbing
                {venue.storeys != null && ` · ${venue.storeys} floors`}
              </span>
            </>
          ) : (
            // A bare em dash reads as a rendering fault. Say what is actually
            // true: nobody has measured this one.
            <span className="small muted">Height not measured yet</span>
          )}
        </div>

        {venue.elevationSource === 'estimated' && (
          <p className="small muted card-note">
            Estimated from floor count — nobody has measured this one yet.{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Know the real figure?
            </a>
          </p>
        )}

        {venue.notes && <p className="small muted card-note">{venue.notes}</p>}

        <PhotoCredit venue={venue} />

        <h3>Routes</h3>
        {routes.length === 0 ? (
          <p className="small muted">
            No routes here yet. If you have climbed it, your GPX would be the first.{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Add one
            </a>
          </p>
        ) : (
          <ul className="route-list">
            {routes.map((route) => {
              const isActive = route.slug === activeRouteSlug;
              return (
                <li key={route.slug}>
                  <button
                    className={`route-row${isActive ? ' active' : ''}`}
                    onClick={() => onSelectRoute(isActive ? null : route.slug)}
                  >
                    <span className="route-name">{route.name}</span>
                    <span className="small muted">
                      {formatDistance(route.distanceM)} · {Math.round(route.gainM)} m up
                      {route.loop ? ' · loop' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {activeRoute && <ElevationProfile points={activeRoute.coordinates} height={90} />}
      </div>
    </aside>
  );
}
