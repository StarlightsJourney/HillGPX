import type { Route, Venue } from '../types';
import { VENUE_TYPE_LABEL, formatDistance, venueHeight } from '../lib/venues';
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
 * A card rather than a fixed panel: the map is what people came for, and a
 * permanent column takes a third of it whether or not anything is selected.
 */
export function VenueCard({
  venue,
  routes,
  activeRouteSlug,
  onSelectRoute,
  onClose,
}: VenueCardProps) {
  const height = venueHeight(venue);
  const activeRoute = routes.find((r) => r.slug === activeRouteSlug) ?? null;

  const detail = [
    VENUE_TYPE_LABEL[venue.type],
    venue.storeys != null ? `${venue.storeys} floors` : null,
    venue.town,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <aside className="venue-card">
      <div className="card-photo">
        <VenueThumb venue={venue} rounded={false} />
        <button className="icon-btn card-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="card-body">
        <h2>{venue.name}</h2>
        <p className="card-detail">{detail}</p>

        {height ? (
          <p className="card-height">
            <strong>{Math.round(height.value)} m</strong>{' '}
            {/* Summit height is not climbing height — nobody starts at sea
                level — so the two are never labelled the same way. */}
            {height.kind === 'gain' ? 'of climbing' : 'above sea level'}
          </p>
        ) : (
          <p className="card-height muted">Height not recorded</p>
        )}

        {height?.kind === 'summit' && (
          <p className="card-detail">
            The climb from the usual start is smaller, and nobody has measured it.{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Measure it
            </a>
          </p>
        )}

        {venue.notes && <p className="card-detail">{venue.notes}</p>}

        <PhotoCredit venue={venue} />

        <hr className="card-rule" />

        {routes.length === 0 ? (
          <p className="card-detail">
            No routes yet.{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Add the first
            </a>
          </p>
        ) : (
          <>
            <h3>
              {routes.length} route{routes.length > 1 ? 's' : ''}
            </h3>
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
          </>
        )}

        {activeRoute && <ElevationProfile points={activeRoute.coordinates} height={80} />}
      </div>
    </aside>
  );
}
