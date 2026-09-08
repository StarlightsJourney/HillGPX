import type { Venue } from '../types';

/**
 * A venue's image.
 *
 * Real street-level photography from Mapillary where it exists — attached at
 * build time by scripts/fetch_photos.py, CC-BY-SA, credited below the image.
 * Mapillary's coverage depends on someone having walked or driven the street
 * with a camera, so plenty of venues have none.
 *
 * Those get an invitation rather than an apology. "No photo yet" was accurate
 * but inert — it told you about a gap and gave you nowhere to go with that.
 * "Add photo" points at the thing a reader can actually do, and on the
 * venue card it is a link to the repo, so the distance between noticing a
 * missing photo and sending one is a single click.
 *
 * The silhouette that used to stand here scaled a triangle to the climb, but
 * the card prints that same height in metres two lines below, so the drawing
 * added nothing the text did not already say — and a decorative shape sitting
 * in a photo slot reads as a photo until you look twice.
 */
export function VenueThumb({ venue, rounded = true }: { venue: Venue; rounded?: boolean }) {
  if (venue.photo?.file) {
    return (
      <span className={`card-thumb${rounded ? '' : ' square'}`}>
        <img
          src={`${import.meta.env.BASE_URL}${venue.photo.file}`}
          alt={venue.name}
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  }

  return (
    <span
      className={`card-thumb placeholder${rounded ? '' : ' square'}`}
      role="img"
      aria-label={`No photo of ${venue.name} yet — add one`}
    >
      {/* The centring lives on this inner box rather than on .card-thumb, which
          the list and the card hero each restyle for their own layout. */}
      <span className="placeholder-inner">
      <svg
        className="placeholder-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="5" width="14.5" height="14" rx="2.5" />
        <circle cx="8" cy="9.8" r="1.3" />
        <path d="M3.6 16.4 L8.4 11.9 L11.6 14.6" />
        {/* A plus, not a slash. The old crossed-out frame said "this is
            broken"; the point is that someone can fix it. */}
        <path d="M19.4 13.6 V20.4 M16 17 H22.8" />
      </svg>
        <span className="placeholder-label">Add photo</span>
      </span>
    </span>
  );
}

/** Attribution line. Required by CC-BY-SA wherever the photo is shown. */
export function PhotoCredit({ venue }: { venue: Venue }) {
  if (!venue.photo?.file) return null;
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
