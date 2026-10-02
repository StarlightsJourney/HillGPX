import { TypeGlyph } from './TypeGlyph';
import type { Venue, VenuePhoto } from '../types';
import { photoSrc } from '../lib/venues';

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
          src={photoSrc(venue.photo)}
          alt={venue.name}
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  }

  return (
    <span className={`card-thumb placeholder${rounded ? '' : ' square'}`} role="img" aria-label={`No photo of ${venue.name} yet — add one`}>
      <PlaceArt venue={venue} />
      <span className="place-art-cta">Add photo</span>
    </span>
  );
}

/**
 * The one placeholder used everywhere a place has no photo yet: a drawn
 * ridge tinted by height for hills and mountains, and a plain tile with the
 * type icon for blocks and stairs.
 */
export function PlaceArt({ venue }: { venue: Venue }) {
  const height = venue.summitM ?? venue.gainM ?? 0;
  const seed = [...venue.slug].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const hue = Math.max(0, 210 - Math.min(height, 6000) / 30);
  const built = venue.type === 'hdb_block' || venue.type === 'stairs' || venue.type === 'carpark';
  const n = (i: number, span: number) => ((seed >> (i * 3)) % span);
  const far = `M0 100 L0 ${66 - n(0, 10)} L22 ${46 + n(1, 10)} L38 ${58 - n(2, 10)} L55 ${26 + n(3, 12)} L72 ${50 + n(4, 10)} L86 ${38 + n(5, 10)} L100 ${56 - n(6, 10)} L100 100 Z`;
  // Built climbs get a plain tile with their type icon; a drawn skyline read as decoration.
  if (built) {
    return (
      <span className="place-art plain" aria-hidden="true">
        <TypeGlyph type={venue.type} size={28} />
      </span>
    );
  }
  return (
    <span className="place-art" style={{ '--hue': hue } as React.CSSProperties} aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d={far} />
        <path className="near" d="M0 100 L0 82 L18 74 L34 84 L52 70 L68 80 L84 72 L100 80 L100 100 Z" />
      </svg>
    </span>
  );
}

/** Attribution line required wherever a published photo is shown. */
export function PhotoCredit({ photo }: { photo: VenuePhoto }) {
  if (!photo.file) return null;
  const { credit, license, licenseUrl, source, sourceUrl } = photo;

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
