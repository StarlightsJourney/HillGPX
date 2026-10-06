import { track } from '../lib/analytics';
import type { Route, Venue } from '../types';
import { HEIGHT_LABEL, townName, venueHeight, venueKindLabel, venuePhotos } from '../lib/venues';
import { PhotoCredit, VenueThumb } from './VenueThumb';
import { useUnits } from './UnitsContext';
import { RatingLabel } from './ResultsList';
import { CloseIcon, HeartIcon } from './icons';
import { toGpx } from '../lib/gpx';

export function downloadRoute(route: Route) {
  track('gpx_download', route.slug);
  const gpx = toGpx(route.name, route.coordinates, [], route.elevationAvailable !== false);
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
  onClose: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  className?: string;
}

/** Compact summary anchored beside one map marker. */
export function VenueCard({
  venue,
  routes,
  onClose,
  isFavorite = false,
  onToggleFavorite,
  className,
}: VenueCardProps) {
  const height = venueHeight(venue);
  const units = useUnits();
  const cover = venuePhotos(venue)[0];
  const detail = [
    venueKindLabel(venue),
    venue.storeys != null ? `${venue.storeys} floors` : null,
    townName(venue.town),
  ]
    .filter(Boolean)
    .join(' · ');
  const routeLabel =
    routes.length > 0 ? ` · ${routes.length} route${routes.length === 1 ? '' : 's'}` : '';

  return (
    <aside className={['venue-card', className].filter(Boolean).join(' ')}>
      <div className="card-photo">
        <VenueThumb venue={venue} rounded={false} />
      </div>
      {onToggleFavorite && (
        <button
          type="button"
          className={`icon-btn card-favorite${isFavorite ? ' on' : ''}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={isFavorite ? 'Remove favourite' : 'Add to favourites'}
          title={isFavorite ? 'Remove favourite' : 'Add to favourites'}
        >
          <HeartIcon size={24} filled={isFavorite} />
        </button>
      )}
      <button className="icon-btn card-close" onClick={onClose} aria-label="Close">
        <CloseIcon size={14} />
      </button>

      {/* A new tab, as on Airbnb: the map keeps its place and selection. */}
      <a className="card-summary" href={`#venue/${venue.slug}`} target="_blank" rel="noopener">
        <div className="card-title-row">
          <h2>{venue.name}</h2>
          <RatingLabel rating={venue.rating} />
        </div>

        <p className="card-kind">{detail}</p>
        {height ? (
          <p className="card-height">
            <strong>{units.height(height.value)}</strong>
            <span>
              {` ${HEIGHT_LABEL[height.kind]}`}
              {routeLabel}
            </span>
          </p>
        ) : (
          <p className="card-height muted">No height recorded{routeLabel}</p>
        )}
      </a>
      {cover && <PhotoCredit photo={cover} />}
    </aside>
  );
}
