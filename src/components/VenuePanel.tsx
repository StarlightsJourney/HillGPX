import type { Route, Venue } from '../types';
import { VENUE_TYPE_LABEL, effectiveGain, formatDistance } from '../lib/venues';
import { gainColor } from '../map/layers';
import { ElevationProfile } from './ElevationProfile';

interface VenuePanelProps {
  venue: Venue;
  routes: Route[];
  activeRouteSlug: string | null;
  onSelectRoute: (slug: string | null) => void;
  onClose: () => void;
}

/**
 * Detail panel for a selected venue: what it is, how much climbing it offers,
 * and the routes attached to it.
 */
export function VenuePanel({
  venue,
  routes,
  activeRouteSlug,
  onSelectRoute,
  onClose,
}: VenuePanelProps) {
  const gain = effectiveGain(venue);
  const activeRoute = routes.find((r) => r.slug === activeRouteSlug) ?? null;

  return (
    <aside className="panel">
      <header className="panel-head">
        <div>
          <span className="chip" style={{ background: gainColor(gain) }}>
            {VENUE_TYPE_LABEL[venue.type]}
          </span>
          <h2>{venue.name}</h2>
          {venue.town && <p className="muted small">{venue.town}</p>}
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close panel">
          ×
        </button>
      </header>

      <div className="stats">
        <Stat
          label="Elevation gain"
          value={gain != null ? `${Math.round(gain)} m` : 'Unknown'}
          hint={venue.gainM == null && venue.summitM != null ? 'summit height, gain not yet measured' : undefined}
        />
        {venue.storeys != null && <Stat label="Storeys" value={String(venue.storeys)} />}
        {venue.summitM != null && venue.gainM != null && (
          <Stat label="Summit" value={`${Math.round(venue.summitM)} m`} />
        )}
      </div>

      {venue.elevationSource === 'estimated' && (
        <p className="callout small">
          These numbers are unverified seed values.{' '}
          <a
            href="https://github.com/StarlightsJourney/HillGPX/blob/main/CONTRIBUTING.md"
            target="_blank"
            rel="noreferrer"
          >
            Help correct them
          </a>
          .
        </p>
      )}

      {venue.notes && <p className="notes small">{venue.notes}</p>}

      <section>
        <h3>Routes</h3>
        {routes.length === 0 ? (
          <p className="muted small">
            No routes here yet. If you have a GPX of a climb at this venue, adding it is a
            one-file pull request.
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
                    <span className="route-meta small muted">
                      {formatDistance(route.distanceM)} · {Math.round(route.gainM)} m up
                      {route.loop ? ' · loop' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {activeRoute && (
        <section>
          <h3>{activeRoute.name}</h3>
          <ElevationProfile points={activeRoute.coordinates} />
          {activeRoute.description && <p className="small">{activeRoute.description}</p>}
          {activeRoute.contributor && (
            <p className="muted small">Contributed by {activeRoute.contributor}</p>
          )}
        </section>
      )}
    </aside>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label small muted">{label}</span>
      {hint && <span className="stat-hint small muted">{hint}</span>}
    </div>
  );
}
