import type { Venue } from '../types';

/**
 * A venue's image.
 *
 * Real photography from Mapillary or open-licence Wikimedia Commons/Flickr —
 * attached at build time and credited below the image. Coverage depends on
 * someone having photographed the venue or its surroundings, so many venues
 * still have none.
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
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="5" width="20" height="15" rx="2" fill="none" />
          <circle cx="7" cy="10.5" r="1.5" fill="currentColor" stroke="none" />
          <path d="M3.5 19 L9 13 L14.5 19" fill="none" />
          <path d="M10 19 L15 14 L19.5 19" fill="none" />
          <circle cx="20" cy="19" r="4" stroke="none" />
          <path d="M20 16.5 V21.5 M17.5 19 H22.5" stroke="#ffffff" strokeWidth="1.5" />
        </svg>
        <span className="placeholder-label">Add photo</span>
      </span>
    </span>
  );
}

/** Attribution line required wherever a published photo is shown. */
export function PhotoCredit({ venue }: { venue: Venue }) {
  if (!venue.photo?.file) return null;
  const { credit, license, licenseUrl, source, sourceUrl } = venue.photo;

  if (source) {
    return (
      <p className="photo-credit small muted">
        {credit ? `Photo by ${credit}` : 'Photo'}
        {source && (
          <>
            {' · '}
            {sourceUrl ? (
              <a href={sourceUrl} target="_blank" rel="noreferrer">
                {source}
              </a>
            ) : source}
          </>
        )}
        {license && (
          <>
            {' · '}
            {licenseUrl ? (
              <a href={licenseUrl} target="_blank" rel="noreferrer">
                {license}
              </a>
            ) : license}
          </>
        )}
      </p>
    );
  }

  return (
    <p className="photo-credit small muted">
      Photo{credit ? ` by ${credit}` : ''} ·{' '}
      <a href="https://www.mapillary.com" target="_blank" rel="noreferrer">
        Mapillary
      </a>
      , CC BY-SA
    </p>
  );
}
