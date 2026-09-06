import type { Route, Venue } from '../types';
import { VENUE_TYPE_LABEL, effectiveGain, formatDistance } from '../lib/venues';
import { ElevationProfile } from './ElevationProfile';

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

      <PhotoSlot venue={venue} />

      <div className="card-body">
        <p className="card-kicker small muted">
          {VENUE_TYPE_LABEL[venue.type]}
          {venue.town && ` · ${venue.town}`}
        </p>
        <h2>{venue.name}</h2>

        <div className="card-stats">
          <span className="card-gain">{gain != null ? `${Math.round(gain)} m` : '—'}</span>
          <span className="small muted">
            of climbing
            {venue.storeys != null && ` · ${venue.storeys} floors`}
          </span>
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

/**
 * Where a contributed photo will go.
 *
 * Until someone adds one this draws a silhouette scaled to the venue's climb, so
 * a 20 m block and a 160 m hill look different at a glance. It is a placeholder
 * that still carries the one fact the card is about, rather than a grey box.
 */
function PhotoSlot({ venue }: { venue: Venue }) {
  const gain = effectiveGain(venue) ?? 0;
  // 160 m is roughly Singapore's highest ground, so this reads as a fraction of
  // the tallest thing you could climb here.
  const fill = Math.max(0.08, Math.min(1, gain / 160));

  return (
    <div className="photo-slot" aria-hidden="true">
      {venue.type === 'hdb_block' ? (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="silhouette">
          <rect x="34" y={60 - fill * 52} width="32" height={fill * 52} rx="1.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="silhouette">
          <path d={`M8 60 L50 ${60 - fill * 52} L92 60 Z`} />
        </svg>
      )}
    </div>
  );
}
