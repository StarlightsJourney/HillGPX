import type { Venue } from '../types';
import { effectiveGain } from '../lib/venues';

/**
 * A venue's image.
 *
 * Real street-level photography from Mapillary where it exists — attached at
 * build time by scripts/fetch_photos.py, CC-BY-SA, credited below the image.
 * Mapillary's coverage depends on someone having walked or driven the street
 * with a camera, so plenty of blocks have none; those fall back to a silhouette
 * scaled to the climb, which at least carries the fact the card is about.
 */
export function VenueThumb({ venue, rounded = true }: { venue: Venue; rounded?: boolean }) {
  if (venue.photo?.url) {
    return (
      <span className={`card-thumb${rounded ? '' : ' square'}`}>
        <img src={venue.photo.url} alt={venue.name} loading="lazy" decoding="async" />
      </span>
    );
  }

  const gain = effectiveGain(venue) ?? 0;
  // 163 m is Singapore's highest ground, so the silhouette reads as a fraction
  // of the tallest thing you could climb here.
  const fill = Math.max(0.1, Math.min(1, gain / 163));
  const isBlock = venue.type === 'hdb_block' || venue.type === 'carpark';

  return (
    <span className={`card-thumb placeholder${rounded ? '' : ' square'}`} aria-hidden="true">
      <svg viewBox="0 0 100 76" preserveAspectRatio="xMidYMax meet">
        {isBlock ? (
          <rect x="36" y={72 - fill * 60} width="28" height={fill * 60} rx="1.5" />
        ) : (
          <path d={`M14 72 L50 ${72 - fill * 60} L86 72 Z`} />
        )}
        <line x1="0" y1="72" x2="100" y2="72" />
      </svg>
    </span>
  );
}

/** Attribution line. Required by CC-BY-SA wherever the photo is shown. */
export function PhotoCredit({ venue }: { venue: Venue }) {
  if (!venue.photo?.url) return null;
  return (
    <p className="photo-credit small muted">
      Photo{venue.photo.credit ? ` by ${venue.photo.credit}` : ''} ·{' '}
      <a href="https://www.mapillary.com" target="_blank" rel="noreferrer">
        Mapillary
      </a>
      , CC BY-SA
    </p>
  );
}
