import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Route, Venue } from '../types';
import { VENUE_TYPE_LABEL, tallestWithin, titleCaseStreet, townName, venueHeight } from '../lib/venues';
import { useUnits } from './UnitsContext';
import { ElevationProfile } from './ElevationProfile';
import { PhotoCredit, VenueThumb } from './VenueThumb';
import { ChevronLeftIcon, DownloadIcon, HeartIcon, MapIcon, Mark, ShareIcon, StarIcon } from './icons';
import { HeaderControls } from './HeaderControls';
import { downloadRoute } from './VenueCard';
import { RatingLabel } from './ResultsList';
import { RouteThumb } from './RouteThumb';
import { REPO_URL, addPhotoUrl } from '../lib/contribute';
import {
  type Photo,
  type Review,
  backendConfigured,
  combinedRating,
  loadAuthor,
  photosForVenue,
  reviewsForVenue,
  saveAuthor,
  submitPhoto,
  submitReview,
} from '../lib/api';
import { regionOf } from '../lib/regions';
import { routeHasElevation } from '../lib/routes';

const MiniMap = lazy(() => import('./MiniMap').then((module) => ({ default: module.MiniMap })));

const RATING_WORDS = ['', 'Not worth it', 'Meh', 'Solid', 'Great session', 'Must do'];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function RateCard({ venue }: { venue: Venue }) {
  const [hover, setHover] = useState(0);
  const [mine, setMine] = useState(0);
  const [comment, setComment] = useState('');
  const [author, setAuthor] = useState(() => loadAuthor());
  const [submitted, setSubmitted] = useState(false);
  const [localReviews, setLocalReviews] = useState<Review[]>(() => reviewsForVenue(venue.slug));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rating = combinedRating(venue.slug, venue.rating);
  const shown = hover || mine;

  const postReview = async () => {
    if (mine === 0) return;
    setSubmitting(true);
    setError(null);
    saveAuthor(author);
    try {
      await submitReview({ venueSlug: venue.slug, rating: mine, comment, author });
      setLocalReviews(reviewsForVenue(venue.slug));
      setSubmitted(true);
      setComment('');
      setMine(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your review');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="venue-detail-section rate-section">
      <div className="venue-section-heading">
        <h2>
          {rating ? (
            <span className="rate-summary">
              <StarIcon size={20} filled /> {rating.average.toFixed(2)} · {rating.count} rating{rating.count === 1 ? '' : 's'}
            </span>
          ) : (
            'Be the first to rate it'
          )}
        </h2>
      </div>
      <p className="muted">
        How good a training venue is it?{backendConfigured() ? '' : ' Your review is stored on this device until a backend is connected.'}
      </p>

      <div className="rate-stars" role="radiogroup" aria-label="Your rating" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mine === value}
            aria-label={`${value} star${value === 1 ? '' : 's'}`}
            className={`rate-star${value <= shown ? ' on' : ''}`}
            onMouseEnter={() => setHover(value)}
            onClick={() => setMine(value)}
          >
            <StarIcon size={28} filled={value <= shown} />
          </button>
        ))}
        <span className="rate-word">{RATING_WORDS[shown]}</span>
      </div>

      {localReviews.length > 0 && (
        <div className="local-reviews">
          {localReviews.slice(0, 3).map((review) => (
            <div key={review.id} className="local-review">
              <div className="local-review-stars">
                {Array.from({ length: 5 }).map((_, i) => (
                  <StarIcon key={i} size={14} filled={i < review.rating} />
                ))}
              </div>
              <p className="local-review-comment">{review.comment || <span className="muted">No comment</span>}</p>
              <p className="local-review-meta">
                {review.author || 'Anonymous'} · {formatDate(review.createdAt)}
                {review.syncedAt ? <span className="synced-badge">synced</span> : <span className="pending-badge">pending</span>}
              </p>
            </div>
          ))}
        </div>
      )}

      {!submitted ? (
        <div className="review-form">
          <textarea
            className="review-comment"
            placeholder="What should other runners know? (optional)"
            rows={3}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <input
            className="review-author"
            type="text"
            placeholder="Your name (optional)"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-dark rate-publish"
            disabled={mine === 0 || submitting}
            onClick={postReview}
          >
            {submitting ? 'Posting…' : 'Post review'}
          </button>
          {error && <p className="review-error">{error}</p>}
        </div>
      ) : (
        <p className="review-thanks">Thanks — your review is saved and will show here{backendConfigured() ? '' : ' once a backend is connected'}.</p>
      )}
    </section>
  );
}

interface VenueDetailProps {
  venue: Venue;
  routes: Route[];
  allVenues: Venue[];
  onClose: () => void;
  onShowOnMap: (routeSlug?: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onRemoveLocalRoute: (slug: string) => void;
}

function FlagGlyph() {
  return <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 15V2m0 1h8l-1.5 3L11 9H3" /></svg>;
}

function CameraGlyph() {
  return <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7h4l1.5-2h7L17 7h4v12H3V7Z" /><circle cx="12" cy="13" r="4" /></svg>;
}

function PhotoCard({ venue }: { venue: Venue }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [credit, setCredit] = useState('');
  const [licence, setLicence] = useState('Own work, CC BY-SA 4.0');
  const [author, setAuthor] = useState(() => loadAuthor());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localPhotos, setLocalPhotos] = useState<Photo[]>(() => photosForVenue(venue.slug));
  const [photoUrl, setPhotoUrl] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);

  const onSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (!selected) return;
    if (selected.size > 650 * 1024) {
      setError('Photo is too large for local storage. Please choose one under 650 KB.');
      return;
    }
    setFile(selected);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(selected);
  };

  const postPhoto = async () => {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    saveAuthor(author);
    try {
      await submitPhoto({ venueSlug: venue.slug, file, credit, licence, author });
      setLocalPhotos(photosForVenue(venue.slug));
      setSubmitted(true);
      setFile(null);
      setPreview(null);
      setCredit('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your photo');
    } finally {
      setSubmitting(false);
    }
  };

  const publishedPhotos = venue.photos ?? (venue.photo ? [venue.photo] : []);
  const hasPhoto = publishedPhotos.length > 0 || localPhotos.length > 0;

  const fetchFromUrl = async () => {
    const url = photoUrl.trim();
    if (!url) return;
    setFetchingUrl(true);
    setError(null);
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('URL did not return an image');
      if (blob.size > 650 * 1024) throw new Error('Image is too large for local storage. Please choose one under 650 KB.');
      const filename = url.split('/').pop()?.split('?')[0] || 'photo.jpg';
      const fetchedFile = new File([blob], filename, { type: blob.type });
      setFile(fetchedFile);
      setPreview(URL.createObjectURL(fetchedFile));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message.includes('CORS') || message.includes('Failed to fetch')
          ? 'This site does not allow direct fetching. Please save the image and upload it instead.'
          : `Could not fetch photo: ${message}`,
      );
    } finally {
      setFetchingUrl(false);
    }
  };

  return (
    <section className="venue-detail-section photo-section">
      <div className="venue-section-heading"><h2>Photos</h2></div>
      <div className="photo-grid">
        {publishedPhotos.map((photo, index) => (
          <div key={photo.file} className="photo-item published-photo">
            <img
              src={`${import.meta.env.BASE_URL}${photo.file}`}
              alt={`${venue.name} photo ${index + 1}`}
              loading={index > 0 ? 'lazy' : undefined}
            />
            <PhotoCredit photo={photo} />
          </div>
        ))}
        {localPhotos.map((photo) => (
          <div key={photo.id} className="photo-item local-photo">
            <img src={photo.dataUrl} alt={`Photo by ${photo.author || 'a contributor'}`} />
            <p className="photo-meta">
              {photo.credit || photo.author || 'Anonymous'}
              {photo.syncedAt ? <span className="synced-badge">synced</span> : <span className="pending-badge">pending</span>}
            </p>
          </div>
        ))}
      </div>

      {!submitted ? (
        <div className="photo-form">
          <label className="photo-upload">
            {preview ? (
              <img src={preview} alt="Preview" />
            ) : (
              <>
                <CameraGlyph />
                <span>Tap to choose a photo</span>
              </>
            )}
            <input type="file" accept="image/*" onChange={onSelect} />
          </label>
          <div className="photo-url-row">
            <input
              className="review-author"
              type="url"
              placeholder="Or paste an image URL"
              value={photoUrl}
              onChange={(event) => setPhotoUrl(event.target.value)}
            />
            <button
              type="button"
              className="btn btn-light"
              disabled={!photoUrl.trim() || fetchingUrl}
              onClick={fetchFromUrl}
            >
              {fetchingUrl ? '…' : 'Fetch'}
            </button>
          </div>
          <input
            className="review-author"
            type="text"
            placeholder="Photographer name or credit"
            value={credit}
            onChange={(event) => setCredit(event.target.value)}
          />
          <input
            className="review-author"
            type="text"
            placeholder="Licence (e.g. Own work, CC BY-SA 4.0)"
            value={licence}
            onChange={(event) => setLicence(event.target.value)}
          />
          <input
            className="review-author"
            type="text"
            placeholder="Your name (optional)"
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
          />
          <button
            type="button"
            className="btn btn-dark"
            disabled={!file || submitting}
            onClick={postPhoto}
          >
            {submitting ? 'Uploading…' : hasPhoto ? 'Add another photo' : 'Add a photo'}
          </button>
          {error && <p className="review-error">{error}</p>}
          {!backendConfigured() && (
            <p className="muted">
              Photos are stored on this device until a backend is connected. Choose images you have the right to share.
            </p>
          )}
        </div>
      ) : (
        <p className="review-thanks">Thanks — your photo is saved{backendConfigured() ? '' : ' on this device'}.</p>
      )}
    </section>
  );
}

function VenueDetailInner({
  venue,
  routes,
  allVenues,
  onClose,
  onShowOnMap,
  isFavorite,
  onToggleFavorite,
  onRemoveLocalRoute,
}: VenueDetailProps) {
  const units = useUnits();
  const [copied, setCopied] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const height = venueHeight(venue);
  const typeLabel = VENUE_TYPE_LABEL[venue.type];
  const area = townName(venue.town) ?? regionOf(venue.lng, venue.lat);
  const street = venue.street ? titleCaseStreet(venue.street) : null;
  const address = [venue.blkNo ? titleCaseStreet(venue.blkNo) : null, street].filter(Boolean).join(' ');
  const heightText = height
    ? `${units.height(height.value)} ${height.kind === 'gain' ? 'EG' : 'summit'}`
    : 'Height not recorded';
  const introMeta = [venue.storeys ? `${venue.storeys} floors` : null, heightText, address || null]
    .filter(Boolean)
    .join(' · ');
  const nearby = useMemo(
    () => tallestWithin(allVenues, venue.lng, venue.lat, 1000, 7)
      .filter((item) => item.venue.slug !== venue.slug)
      .slice(0, 6),
    [allVenues, venue],
  );
  const aboutParts = [
    height?.kind === 'summit'
      ? 'Height is to the summit. The actual climb from the usual start is smaller and has not been measured yet.'
      : null,
    venue.type === 'hdb_block' && venue.elevationSource === 'estimated' && venue.storeys
      ? `Height is estimated from ${venue.storeys} storeys × 2.5 m per floor. Take the stairwell and check it is open.`
      : null,
    venue.notes ?? null,
  ].filter((part): part is string => Boolean(part));
  const aboutIsLong = aboutParts.join(' ').length > 220;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
    };
  }, [onClose]);

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: venue.name, url });
    else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const sourceLine = venue.elevationSource === 'estimated'
    ? venue.storeys ? `Estimated from ${venue.storeys} storeys × 2.5 m` : 'Estimated'
    : venue.elevationSource === 'dem'
      ? 'Sampled from the terrain model'
      : venue.elevationSource === 'community'
        ? 'Measured by a contributor'
        : 'Verified against an authoritative source';

  return createPortal(
    <div className="venue-detail">
      <header className="venue-detail-topbar">
        <button type="button" className="venue-detail-back" onClick={onClose} aria-label="Back to map"><ChevronLeftIcon size={20} /></button>
        <a className="wordmark" href="#"><Mark size={30} /><span>hill<span className="dot">GPX</span></span></a>
        <HeaderControls />
      </header>

      <main className="venue-detail-content">
        <div className="venue-detail-title-row">
          <div>
            <h1>{venue.name}</h1>
            <p className="venue-detail-sub">
              <RatingLabel rating={venue.rating} />
              {venue.rating && <span aria-hidden="true"> · </span>}
              {area ? `${typeLabel} in ${area}` : typeLabel}
            </p>
          </div>
          <div className="venue-detail-title-actions">
            <button type="button" aria-label="Share" onClick={() => void share()}><ShareIcon size={16} /><span className="venue-action-label">{copied ? 'Link copied' : 'Share'}</span></button>
            <button type="button" aria-label="Save" onClick={onToggleFavorite}><HeartIcon size={16} filled={isFavorite} /><span className="venue-action-label">{isFavorite ? 'Saved' : 'Save'}</span></button>
          </div>
        </div>

        {venue.photo?.file ? (
          <div className="venue-detail-gallery">
            <div className="venue-detail-hero"><VenueThumb venue={venue} rounded={false} /></div>
            {venue.photo && <PhotoCredit photo={venue.photo} />}
          </div>
        ) : (
          <div className="venue-detail-empty-photo">
            <CameraGlyph />
            <strong>No photo yet</strong>
            <p>Been here? Share a photo so the next person knows what they are walking into.</p>
            <a className="btn btn-light" href={addPhotoUrl(venue.slug, venue.name)} target="_blank" rel="noreferrer">
              Add a photo
            </a>
          </div>
        )}

        <div className="venue-detail-layout">
          <div className="venue-detail-main">
            <section className="venue-detail-intro">
              <h2>The EG</h2>
              <p>{introMeta}</p>
            </section>

            <section className="venue-detail-section">
              <h2>About this venue</h2>
              <div className={`venue-about-copy${aboutIsLong && !aboutExpanded ? ' clamped' : ''}`}>
                {aboutParts.map((part) => <p key={part}>{part}</p>)}
              </div>
              {aboutIsLong && <button type="button" className="venue-show-more" onClick={() => setAboutExpanded((value) => !value)}>{aboutExpanded ? 'Show less' : 'Show more'}</button>}
            </section>

            <section className="venue-detail-section venue-routes-section">
              {routes.length > 0 ? (
                <>
                  <h2>Routes that pass here</h2>
                  <div className="venue-route-grid">
                    {routes.map((route) => (
                      <article className="venue-route-card" key={route.slug}>
                        <RouteThumb route={route} />
                        {routeHasElevation(route) && <div className="venue-route-profile"><ElevationProfile points={route.coordinates} height={64} /></div>}
                        <h3>{route.name}</h3>
                        <p>{units.distance(route.distanceM)} · {routeHasElevation(route) ? `${units.height(route.gainM)} EG` : 'Elevation unavailable'}{route.loop ? ' · loop' : ''}</p>
                        {route.source === 'local' && <span className="local-route-tag">Saved on this device</span>}
                        <div className="venue-route-actions">
                          <button type="button" onClick={() => onShowOnMap(route.slug)}>Show on map</button>
                          <button type="button" onClick={() => downloadRoute(route)}>Download</button>
                          {route.source === 'local' && <button type="button" className="muted" onClick={() => onRemoveLocalRoute(route.slug)}>Remove</button>}
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-state venue-routes-empty">
                  <h3>No routes yet</h3>
                  <p>Import a GPX that passes this venue and save it, or add one to the repository on GitHub.</p>
                </div>
              )}
            </section>

            <RateCard venue={venue} />
            <PhotoCard venue={venue} />

            {nearby.length > 0 && (
              <section className="venue-detail-section">
                <div className="venue-section-heading"><h2>Nearby venues</h2><span>Within 1 km</span></div>
                <div className="nearby-grid">
                  {nearby.map(({ venue: item }) => {
                    const itemHeight = venueHeight(item);
                    return <a className="nearby-card" href={`#venue/${item.slug}`} key={item.slug}><VenueThumb venue={item} /><strong>{item.name}</strong><span>{VENUE_TYPE_LABEL[item.type]}{itemHeight ? ` · ${units.height(itemHeight.value)} ${itemHeight.kind === 'gain' ? 'EG' : 'summit'}` : ''}</span></a>;
                  })}
                </div>
              </section>
            )}

            <section className="venue-detail-section venue-location-section">
              <h2>Where it is</h2>
              <Suspense fallback={<div className="mini-map mini-map-fallback" />}><MiniMap venue={venue} /></Suspense>
              <p className="venue-location-line">{[area, street].filter(Boolean).join(' · ')}</p>
              <button type="button" className="venue-open-map" onClick={() => onShowOnMap()}>Open in the map</button>
            </section>
          </div>

          <aside className="venue-detail-side">
            <div className="venue-actions-card">
              <p className="venue-actions-height">{height ? <><strong>{units.height(height.value)}</strong> {height.kind === 'gain' ? 'EG' : 'summit'}</> : 'Height not recorded'}</p>
              <p className="venue-actions-source">{sourceLine}</p>
              <button type="button" className="venue-primary-action" onClick={() => onShowOnMap()}><MapIcon size={16} />Show on map</button>
              {routes.length > 0 && <button type="button" className="venue-download-action" onClick={() => downloadRoute(routes[0])}><DownloadIcon size={16} />Download GPX{routes.length > 1 ? ` (${routes.length})` : ''}</button>}
              <div className="venue-card-actions"><button type="button" onClick={onToggleFavorite}><HeartIcon size={16} filled={isFavorite} />{isFavorite ? 'Saved' : 'Save'}</button><button type="button" onClick={() => void share()}><ShareIcon size={16} />{copied ? 'Link copied' : 'Share'}</button></div>
            </div>
            <a className="venue-report" href={`${REPO_URL}/issues/new?title=${encodeURIComponent(`Problem: ${venue.name} (${venue.slug})`)}`} target="_blank" rel="noreferrer"><FlagGlyph />Report a problem with this venue</a>
          </aside>
        </div>
        <div className="venue-mobile-secondary-actions">
          {routes.length > 0 && <button type="button" onClick={() => downloadRoute(routes[0])}><DownloadIcon size={16} />Download GPX{routes.length > 1 ? ` (${routes.length})` : ''}</button>}
          <a href={`${REPO_URL}/issues/new?title=${encodeURIComponent(`Problem: ${venue.name} (${venue.slug})`)}`} target="_blank" rel="noreferrer"><FlagGlyph />Report a problem</a>
        </div>
      </main>

      <div className="venue-mobile-bar">
        <p>{height ? <><strong>{units.height(height.value)}</strong> {height.kind === 'gain' ? 'EG' : 'summit'}</> : 'Height not recorded'}</p>
        <button type="button" onClick={() => onShowOnMap()}><MapIcon size={16} />Show on map</button>
      </div>
    </div>,
    document.body,
  );
}

export const VenueDetail = VenueDetailInner;
