import { useEffect } from 'react';
import type { Route, Venue } from '../types';
import { VENUE_TYPE_LABEL, townName, venueHeight } from '../lib/venues';
import { ElevationProfile } from './ElevationProfile';
import { PhotoCredit, VenueThumb } from './VenueThumb';
import { useUnits } from './UnitsContext';
import { CloseIcon, DownloadIcon, EyeIcon, HeartIcon, StarIcon } from './icons';

const REPO_URL = 'https://github.com/StarlightsJourney/HillGPX';

export function downloadRoute(route: Route) {
  const points = route.coordinates
    .map(([lng, lat, ele]) => `        <trkpt lat="${lat}" lon="${lng}"><ele>${ele}</ele></trkpt>`)
    .join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="hillGPX">
  <trk>
    <name>${route.name}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>`;
  const blob = new Blob([gpx], { type: 'application/gpx+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${route.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.gpx`;
  a.click();
  URL.revokeObjectURL(url);
}

interface VenueCardProps {
  venue: Venue;
  routes: Route[];
  activeRouteSlug: string | null;
  onSelectRoute: (slug: string | null) => void;
  onClose: () => void;
  onOpenDetail?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  rating?: number;
  onRate?: (rating: number) => void;
  views?: number;
  onView?: (slug: string) => void;
  className?: string;
}

/**
 * Detail for one venue, shown above its map marker.
 *
 * The layout borrows from Airbnb's listing card: a large photo with a heart,
 * a title row with a star rating / view count, and the key number — elevation —
 * styled like a price. The summary is clickable to open the full detail sheet.
 */
export function VenueCard({
  venue,
  routes,
  activeRouteSlug,
  onSelectRoute,
  onClose,
  onOpenDetail,
  isFavorite = false,
  onToggleFavorite,
  rating = 0,
  onRate,
  views = 0,
  onView,
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

  useEffect(() => {
    onView?.(venue.slug);
  }, [venue.slug, onView]);

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
        {onToggleFavorite && (
          <button
            type="button"
            className={`icon-btn card-favorite${isFavorite ? ' on' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite();
            }}
            aria-label={isFavorite ? 'Remove favourite' : 'Add to favourites'}
            title={isFavorite ? 'Remove favourite' : 'Add to favourites'}
          >
            <HeartIcon size={16} filled={isFavorite} />
          </button>
        )}
        <button className="icon-btn card-close" onClick={onClose} aria-label="Close">
          <CloseIcon size={14} />
        </button>
      </div>

      <div
        className={`card-summary${onOpenDetail ? ' clickable' : ''}`}
        onClick={onOpenDetail}
        role={onOpenDetail ? 'button' : undefined}
        tabIndex={onOpenDetail ? 0 : -1}
      >
        <div className="card-title-row">
          <h2>{venue.name}</h2>
          {onRate && (
            <button
              type="button"
              className="card-rating"
              onClick={(e) => {
                e.stopPropagation();
                onRate(rating ? 0 : 1);
              }}
              aria-label={rating ? 'Change rating' : 'Rate this venue'}
              title={rating ? 'Rated 1 star' : 'Rate this venue'}
            >
              <StarIcon size={14} filled={rating > 0} />
              <span>{rating ? '1.0' : 'Rate'}</span>
            </button>
          )}
        </div>

        <p className="card-kind">{detail}</p>

        <p className="card-views small muted">
          <EyeIcon size={14} /> {views} viewed
        </p>

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
            Height is to the summit. The actual climb from the usual start is smaller and has not
            been measured yet.{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Measure it
            </a>
          </p>
        )}

        {venue.notes && <p className="card-note">{venue.notes}</p>}

        <PhotoCredit venue={venue} />
      </div>

      {routes.length > 0 && (
        <>
          <h3>
            {routes.length} route{routes.length > 1 ? 's' : ''}
          </h3>
          <ul className="route-list">
            {routes.map((route) => {
              const isActive = route.slug === activeRouteSlug;
              return (
                <li key={route.slug} className="route-row">
                  <button
                    className={`route-info${isActive ? ' active' : ''}`}
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
                    className="route-download"
                    aria-label={`Download GPX for ${route.name}`}
                    title="Download GPX"
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadRoute(route);
                    }}
                  >
                    <DownloadIcon size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {activeRoute && <ElevationProfile points={activeRoute.coordinates} height={80} />}
    </aside>
  );
}
