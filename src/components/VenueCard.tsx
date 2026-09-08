import type { Route, Venue } from '../types';
import { VENUE_TYPE_LABEL, townName, venueHeight } from '../lib/venues';
import { ElevationProfile } from './ElevationProfile';
import { PhotoCredit, VenueThumb } from './VenueThumb';
import { useUnits } from './UnitsContext';

const REPO_URL = 'https://github.com/StarlightsJourney/HillGPX';

interface VenueCardProps {
  venue: Venue;
  routes: Route[];
  activeRouteSlug: string | null;
  onSelectRoute: (slug: string | null) => void;
  onClose: () => void;
  className?: string;
}

/**
 * Detail for one venue, shown above its map marker.
 *
 * The layout borrows from Airbnb's listing card: a large photo, the type and
 * town first, the venue name second, and the key number — elevation — styled like
 * a price. The wording is kept factual and concise; nothing is dressed up as
 * more certain than the data behind it.
 */
export function VenueCard({
  venue,
  routes,
  activeRouteSlug,
  onSelectRoute,
  onClose,
  className,
}: VenueCardProps) {
  const height = venueHeight(venue);
  const activeRoute = routes.find((r) => r.slug === activeRouteSlug) ?? null;
  const units = useUnits();

  const typeLabel = VENUE_TYPE_LABEL[venue.type];
  const area = townName(venue.town);

  const detail = [typeLabel, venue.storeys != null ? `${venue.storeys} floors` : null, area]
    .filter(Boolean)
    .join(' · ');

  return (
    <aside className={['venue-card', className].filter(Boolean).join(' ')}>
      <div className="card-photo">
        {venue.photo?.file ? (
          <VenueThumb venue={venue} rounded={false} />
        ) : (
          <a className="card-photo-add" href={REPO_URL} target="_blank" rel="noreferrer">
            <VenueThumb venue={venue} rounded={false} />
          </a>
        )}
        <button className="icon-btn card-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="card-body">
        <h2>{venue.name}</h2>
        <p className="card-kind">{detail}</p>

        {height ? (
          <p className="card-height">
            <strong>{units.height(height.value)}</strong>
            <span>{height.kind === 'gain' ? ' elevation gain' : ' summit height'}</span>
          </p>
        ) : (
          <p className="card-height muted">No height recorded</p>
        )}

        {height?.kind === 'summit' && (
          <p className="card-note">
            Height is to the summit. The actual climb from the usual start is
            smaller and has not been measured yet.{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Measure it
            </a>
          </p>
        )}

        {venue.notes && <p className="card-note">{venue.notes}</p>}

        <PhotoCredit venue={venue} />

        <hr className="card-rule" />

        {routes.length === 0 ? (
          <p className="card-note">
            No routes yet.{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Add a GPX track
            </a>{' '}
            to share a climb.
          </p>
        ) : (
          <>
            <h3>
              {routes.length} climb route{routes.length > 1 ? 's' : ''}
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
                        {units.distance(route.distanceM)} · {units.height(route.gainM)} gain
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
