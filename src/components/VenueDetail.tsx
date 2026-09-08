import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Route, Venue } from '../types';
import { VENUE_TYPE_LABEL, townName, venueHeight } from '../lib/venues';
import { useUnits } from './UnitsContext';
import { ElevationProfile } from './ElevationProfile';
import { PhotoCredit, VenueThumb } from './VenueThumb';
import { CloseIcon, DownloadIcon } from './icons';
import { downloadRoute } from './VenueCard';

interface VenueDetailProps {
  venue: Venue;
  routes: Route[];
  activeRouteSlug: string | null;
  onSelectRoute: (slug: string | null) => void;
  onClose: () => void;
}

function VenueDetailInner({
  venue,
  routes,
  activeRouteSlug,
  onSelectRoute,
  onClose,
}: VenueDetailProps) {
  const units = useUnits();
  const height = venueHeight(venue);
  const typeLabel = VENUE_TYPE_LABEL[venue.type];
  const area = townName(venue.town);
  const activeRoute = routes.find((r) => r.slug === activeRouteSlug) ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="venue-detail" role="dialog" aria-modal="true" aria-label={venue.name}>
      <div className="venue-detail-scrim" onClick={onClose} />
      <div className="venue-detail-sheet">
        <button type="button" className="venue-detail-close" onClick={onClose} aria-label="Close details">
          <CloseIcon size={18} />
        </button>

        <div className="venue-detail-hero">
          <VenueThumb venue={venue} rounded={false} />
        </div>

        <div className="venue-detail-body">
          <h1 className="venue-detail-title">{venue.name}</h1>
          <p className="venue-detail-subtitle">
            {[typeLabel, area, venue.storeys ? `${venue.storeys} floors` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>

          {height ? (
            <p className="venue-detail-height">
              <strong>{units.height(height.value)}</strong>
              <span>{height.kind === 'gain' ? ' elevation gain' : ' summit height'}</span>
            </p>
          ) : (
            <p className="venue-detail-height muted">No height recorded</p>
          )}

          <section className="venue-detail-section">
            <h2>About this climb</h2>
            {height?.kind === 'summit' ? (
              <p>
                Height is to the summit. The actual climb from the usual start is smaller and has
                not been measured yet.
              </p>
            ) : (
              <p>
                Elevation data is sourced from the DEM, community measurements, or building records
                where applicable.
              </p>
            )}
            {venue.notes && <p>{venue.notes}</p>}
          </section>

          <section className="venue-detail-section">
            <h2>What this venue offers</h2>
            <ul className="venue-detail-features">
              <li>{typeLabel}</li>
              {area && <li>{area}</li>}
              {venue.storeys && <li>{venue.storeys} floors</li>}
              <li>{units.height(height?.value ?? 0)} height</li>
              <li>
                {routes.length} route{routes.length === 1 ? '' : 's'}
              </li>
            </ul>
          </section>

          {routes.length > 0 && (
            <section className="venue-detail-section">
              <h2>Routes</h2>
              <ul className="venue-detail-routes">
                {routes.map((route) => {
                  const isActive = route.slug === activeRouteSlug;
                  return (
                    <li key={route.slug} className="venue-detail-route">
                      <button
                        type="button"
                        className={`venue-detail-route-btn${isActive ? ' active' : ''}`}
                        onClick={() => onSelectRoute(isActive ? null : route.slug)}
                      >
                        <span className="route-name">{route.name}</span>
                        <span className="small muted">
                          {units.distance(route.distanceM)} · {units.height(route.gainM)} gain
                          {route.loop ? ' · loop' : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="venue-detail-download"
                        aria-label={`Download GPX for ${route.name}`}
                        title="Download GPX"
                        onClick={() => downloadRoute(route)}
                      >
                        <DownloadIcon size={18} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {activeRoute && (
            <section className="venue-detail-section">
              <h2>Elevation profile</h2>
              <ElevationProfile points={activeRoute.coordinates} height={120} />
            </section>
          )}

          <PhotoCredit venue={venue} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const VenueDetail = VenueDetailInner;
