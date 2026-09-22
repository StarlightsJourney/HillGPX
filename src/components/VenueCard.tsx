import type { Route, Venue } from '../types';
import { VENUE_TYPE_LABEL, townName, venueHeight } from '../lib/venues';
import { PhotoCredit, VenueThumb } from './VenueThumb';
import { useUnits } from './UnitsContext';
import { CloseIcon, HeartIcon } from './icons';

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
  const detail = [
    VENUE_TYPE_LABEL[venue.type],
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

      <a className="card-summary" href={`#venue/${venue.slug}`}>
        <div className="card-title-row">
          <h2>{venue.name}</h2>
        </div>

        <p className="card-kind">{detail}</p>
        {height ? (
          <p className="card-height">
            <strong>{units.height(height.value)}</strong>
            <span>
              {height.kind === 'gain' ? ' to climb' : ' above sea level'}
              {routeLabel}
            </span>
          </p>
        ) : (
          <p className="card-height muted">No height recorded{routeLabel}</p>
        )}
      </a>
      <PhotoCredit venue={venue} />
    </aside>
  );
}
