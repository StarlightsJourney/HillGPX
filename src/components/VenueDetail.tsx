import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Route, Venue, VenuePhoto } from '../types';
import {
  HEIGHT_LABEL,
  commonsFileName,
  photoKey,
  photoSrc,
  tallestWithin,
  titleCaseStreet,
  townName,
  venueHeight,
  venueKindLabel,
  venuePhotoKeys,
  venuePhotos,
} from '../lib/venues';
import { useUnits } from './UnitsContext';
import { ElevationProfile } from './ElevationProfile';
import { PlaceArt, VenueThumb } from './VenueThumb';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon, HeartIcon, MapIcon, StarIcon, UploadIcon } from './icons';
import { FlagIcon, LinkIcon, PlusIcon, ReportModal } from './ReportModal';
import { useReveal } from './useReveal';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { SearchBar } from './SearchBar';
import { RatingLabel } from './ResultsList';
import { directionsUrl, venueConditions, type Conditions } from '../lib/conditions';
import { downloadRoute } from './VenueCard';
import { RouteThumb } from './RouteThumb';
import { Modal } from './Modal';
import { FadeImage } from './FadeImage';
import { OpenSourceBadge } from './OpenSourceNotice';
import { openImportHere, requestReport } from '../lib/contribute';
import {
  type CommunityPhoto,
  type Review,
  combinedRating,
  fetchPhotos,
  fetchReviews,
  loadAuthor,
  saveAuthor,
  submitPhoto,
  submitReview,
} from '../lib/api';
import { boundsToHash, regionOf } from '../lib/regions';
import { lockPageScroll } from '../lib/dom';
import { routeHasElevation } from '../lib/routes';
import { ACTIVITY_LABEL, routeActivity } from '../lib/routeAnalysis';
import { isWorldPeakSlug, loadPeakPhotos } from '../lib/worldPeaks';
import { commonsPhotos, generatedDescription, wikiSummary, type GeneratedDescription, type WikiSummary } from '../lib/wiki';

const MiniMap = lazy(() => import('./MiniMap').then((module) => ({ default: module.MiniMap })));

const RATING_WORDS = ['', 'Not worth it', 'Meh', 'Solid', 'Great session', 'Must do'];

/** Airbnb's grid: one large photo and up to four small ones. */
const GRID_SIZE = 5;

/** Built climbs: a Commons photo "within 1 km" of a block is a photo of somewhere else. */
const BUILT_TYPES: ReadonlySet<Venue['type']> = new Set(['hdb_block', 'stairs', 'carpark']);

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

/** One photo in the gallery, from whichever source it came. */
interface GalleryPhoto {
  key: string;
  src: string;
  /** Lower-resolution file to fall back to if the sharp one is missing. */
  fallback?: string;
  credit: string;
  creditUrl?: string;
  licence?: string;
  /** Identities used to drop the same file arriving from two sources (see `photoKey`). */
  keys: string[];
  /** Set for photos people added here, which anyone can report. */
  communityId?: string;
}

/**
 * The stored files are 420 px card thumbnails (and world-summit links are
 * 960 px thumbs), soft at page width. Commons photos are fetched sharp straight
 * from Wikimedia (Special:FilePath scales on request); Mapillary originals are
 * not kept, so those stay at card size.
 */
function sharpPhoto(photo: VenuePhoto): string | undefined {
  const name = commonsFileName(photo.sourceUrl ?? '') ?? commonsFileName(photo.file);
  return name ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=1280` : undefined;
}

function storedGalleryPhoto(photo: VenuePhoto): GalleryPhoto {
  const sharp = sharpPhoto(photo);
  return {
    key: photo.file,
    src: sharp ?? photoSrc(photo),
    fallback: sharp ? photoSrc(photo) : undefined,
    credit: photo.credit ?? (photo.source ?? 'Mapillary'),
    creditUrl: photo.sourceUrl,
    licence: photo.license ?? (photo.source ? undefined : 'CC BY-SA · Mapillary'),
    keys: venuePhotoKeys(photo),
  };
}

function useVenueContent(venue: Venue) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [communityPhotos, setCommunityPhotos] = useState<CommunityPhoto[]>([]);
  const [commons, setCommons] = useState<GalleryPhoto[]>([]);
  const [wiki, setWiki] = useState<WikiSummary | null>(null);
  const [generated, setGenerated] = useState<GeneratedDescription | null>(null);

  useEffect(() => {
    let cancelled = false;
    const guard = <T,>(set: (value: T) => void) => (value: T) => {
      if (!cancelled) set(value);
    };
    fetchReviews(venue.slug).then(guard(setReviews)).catch(() => undefined);
    fetchPhotos(venue.slug).then(guard(setCommunityPhotos)).catch(() => undefined);
    wikiSummary(venue).then(guard(setWiki)).catch(() => undefined);
    generatedDescription(venue.slug).then(guard(setGenerated)).catch(() => undefined);
    // Open-licence photos taken nearby fill out a hill's grid, after its own
    // photos. Never for blocks and stairs: nearby is not the place.
    const stored = venuePhotos(venue);
    if (!BUILT_TYPES.has(venue.type) && stored.length < GRID_SIZE) {
      const peakPhoto = stored.length === 0 && isWorldPeakSlug(venue.slug)
        ? loadPeakPhotos().then((photos) => photos.get(venue.slug))
        : Promise.resolve(undefined);
      Promise.all([peakPhoto, commonsPhotos(venue)])
        .then(([lead, nearby]) => [
          ...(lead ? [{ url: lead.url, pageUrl: lead.pageUrl, artist: lead.credit, licence: lead.licence, nearby: false }] : []),
          ...nearby.map((photo) => ({ ...photo, nearby: true })),
        ])
        .then((photos) => photos.map((photo, i): GalleryPhoto => ({
          key: `commons-${i}`,
          src: photo.url,
          credit: photo.artist,
          creditUrl: photo.pageUrl,
          licence: `${photo.licence} · Wikimedia Commons${photo.nearby ? ', taken nearby' : ''}`,
          keys: [photoKey(photo.url), photoKey(photo.pageUrl)],
        })))
        .then(guard(setCommons))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [venue]);

  // After someone adds photos they are live, so fetch the list again.
  const reloadPhotos = useCallback(() => {
    fetchPhotos(venue.slug).then(setCommunityPhotos).catch(() => undefined);
  }, [venue.slug]);

  return { reviews, setReviews, communityPhotos, reloadPhotos, commons, wiki, generated };
}

const NARROW_QUERY = '(max-width: 743px)';
function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
/** Phones get the swipe carousel; wider screens get Airbnb's photo grid. */
function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_QUERY).matches);
}

function swapToFallback(photo: GalleryPhoto) {
  return (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (photo.fallback && event.currentTarget.src !== photo.fallback) event.currentTarget.src = photo.fallback;
  };
}

function PhotoCreditText({ photo }: { photo: GalleryPhoto }) {
  return (
    <>
      Photo by {photo.creditUrl ? <a href={photo.creditUrl} target="_blank" rel="noreferrer">{photo.credit}</a> : photo.credit}
      {photo.licence ? ` · ${photo.licence}` : ''}
    </>
  );
}

const creditTitle = (photo: GalleryPhoto) => `Photo by ${photo.credit}${photo.licence ? ` · ${photo.licence}` : ''}`;

/** No photo at all: the same drawn placeholder the cards use, with the invitation on top. */
function NoPhotos({ venue, onAdd, actions }: { venue: Venue; onAdd: () => void; actions?: ReactNode }) {
  return (
    <div className="venue-gallery-empty has-art">
      <PlaceArt venue={venue} />
      {actions && <div className="carousel-actions">{actions}</div>}
      <div className="venue-gallery-empty-copy">
        <CameraGlyph />
        <strong>No photos yet</strong>
        <p>Been here? A photo of the trailhead or the view helps the next person.</p>
        <button type="button" className="btn btn-dark" onClick={onAdd}>Add a photo</button>
      </div>
    </div>
  );
}

/**
 * Airbnb's listing photos on wide screens: one large photo on the left and up
 * to four on the right, rounded on the outside corners only. Any photo opens
 * the full-screen viewer, which steps through every photo with its credit; the
 * last cell says how many more there are. One photo fills the frame.
 */
function PhotoGrid({ photos, venueName, onAdd }: { photos: GalleryPhoto[]; venueName: string; onAdd: () => void }) {
  const [viewer, setViewer] = useState<number | null>(null);
  const closeViewer = useCallback(() => setViewer(null), []);
  const shown = photos.slice(0, GRID_SIZE);
  const count = photos.length;
  const hidden = count - shown.length;

  return (
    <div className="venue-photo-grid-wrap">
      <div className="venue-photo-frame">
        <div className={`venue-photo-grid n${shown.length}`}>
          {shown.map((photo, i) => (
            <button
              type="button"
              key={photo.key}
              className="venue-photo-cell"
              title={creditTitle(photo)}
              aria-label={`Open photo ${i + 1} of ${count} of ${venueName}`}
              onClick={() => setViewer(i)}
            >
              <FadeImage src={photo.src} alt="" loading={i === 0 ? 'eager' : 'lazy'} decoding="async" onError={swapToFallback(photo)} />
              {hidden > 0 && i === shown.length - 1 && <span className="venue-photo-more">+{hidden}</span>}
            </button>
          ))}
        </div>
        <div className="venue-photo-grid-actions">
          <button type="button" className="venue-photo-pill" onClick={onAdd}><PlusIcon />Add photos</button>
        </div>
      </div>
      <p className="venue-photo-credit"><PhotoCreditText photo={photos[0]} /></p>
      {viewer != null && <Lightbox photos={photos} index={viewer} onIndex={setViewer} onClose={closeViewer} />}
    </div>
  );
}

const AUTOPLAY_MS = 5000;

/**
 * One photo at a time, with arrows on either side, a counter, and gentle
 * auto-advance that pauses while you are hovering or have interacted — the
 * Airbnb listing carousel on phones. Tapping the photo opens it full screen.
 */
function PhotoCarousel({ photos, onAdd, actions }: { photos: GalleryPhoto[]; onAdd: () => void; actions: ReactNode }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const closeFullscreen = useCallback(() => setFullscreen(false), []);
  const count = photos.length;
  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  useEffect(() => {
    if (count < 2 || paused || fullscreen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [count, paused, fullscreen]);

  return (
    <>
      <div
        className="carousel"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onTouchStart={() => setPaused(true)}
      >
        <Slides photos={photos} index={index} onIndex={setIndex} onOpen={() => setFullscreen(true)} />
        {count > 1 && (
          <>
            <button type="button" className="carousel-arrow prev" aria-label="Previous photo" onClick={() => { setPaused(true); go(-1); }}>
              <ChevronLeftIcon size={16} />
            </button>
            <button type="button" className="carousel-arrow next" aria-label="Next photo" onClick={() => { setPaused(true); go(1); }}>
              <ChevronRightIcon size={16} />
            </button>
            <span className="carousel-count">{index + 1} / {count}</span>
            <span className="carousel-dots" aria-hidden="true">
              {photos.slice(0, 8).map((photo, i) => <i key={photo.key} className={i === index % 8 ? 'on' : ''} />)}
            </span>
          </>
        )}
        <div className="carousel-actions">{actions}</div>
        <button type="button" className="carousel-add" onClick={onAdd} aria-label="Add photos" data-tip="Add photos"><PlusIcon /></button>
        <p className="carousel-credit"><PhotoCreditText photo={photos[index]} /></p>
      </div>
      {fullscreen && <Lightbox photos={photos} index={index} onIndex={setIndex} onClose={closeFullscreen} />}
    </>
  );
}

/** A horizontal strip that snaps one photo per view: swipe on touch, arrows elsewhere. */
function Slides({ photos, index, onIndex, onOpen }: { photos: GalleryPhoto[]; index: number; onIndex: (i: number) => void; onOpen?: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const target = index * track.clientWidth;
    if (Math.abs(track.scrollLeft - target) < 2) return;
    programmatic.current = true;
    track.scrollTo({ left: target, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const done = window.setTimeout(() => (programmatic.current = false), 600);
    return () => window.clearTimeout(done);
  }, [index]);

  return (
    <div
      className="carousel-track"
      ref={trackRef}
      onScroll={(event) => {
        if (programmatic.current) return;
        const track = event.currentTarget;
        const next = Math.round(track.scrollLeft / track.clientWidth);
        if (next !== index) onIndex(next);
      }}
    >
      {photos.map((photo, i) => (
        <button type="button" key={photo.key} className="carousel-slide" onClick={onOpen} aria-label={onOpen ? `Open photo ${i + 1} full screen` : undefined} tabIndex={onOpen ? 0 : -1}>
          <FadeImage
            src={photo.src}
            alt=""
            loading={Math.abs(i - index) <= 1 ? 'eager' : 'lazy'}
            decoding="async"
            onError={swapToFallback(photo)}
          />
        </button>
      ))}
    </div>
  );
}

function Lightbox({ photos, index, onIndex, onClose }: { photos: GalleryPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const count = photos.length;
  useEffect(() => {
    // Capture on window, ahead of the dialog underneath: Escape closes only this.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'ArrowRight') onIndex((index + 1) % count);
      if (event.key === 'ArrowLeft') onIndex((index - 1 + count) % count);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, count, onIndex, onClose]);

  useEffect(() => lockPageScroll(), []);

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photos">
      <header className="lightbox-head">
        <button type="button" onClick={onClose} aria-label="Close photos"><CloseIcon size={14} />Close</button>
        <span>{index + 1} / {count}</span>
        {photos[index].communityId && (
          <button
            type="button"
            className="lightbox-report"
            onClick={() => {
              const id = photos[index].communityId;
              onClose();
              if (id) requestReport({ targetType: 'photo', targetSlug: id, targetName: 'this photo' });
            }}
          >
            <FlagIcon />Report
          </button>
        )}
      </header>
      <div className="lightbox-stage">
        <Slides photos={photos} index={index} onIndex={onIndex} />
        {count > 1 && (
          <>
            <button type="button" className="carousel-arrow prev" aria-label="Previous photo" onClick={() => onIndex((index - 1 + count) % count)}><ChevronLeftIcon size={18} /></button>
            <button type="button" className="carousel-arrow next" aria-label="Next photo" onClick={() => onIndex((index + 1) % count)}><ChevronRightIcon size={18} /></button>
          </>
        )}
      </div>
      <p className="lightbox-credit"><PhotoCreditText photo={photos[index]} /></p>
    </div>,
    document.body,
  );
}

function Stars({ value, size = 10 }: { value: number; size?: number }) {
  return (
    <span className="stars" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <StarIcon key={i} size={size} filled={i <= Math.round(value)} />)}
    </span>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const [expanded, setExpanded] = useState(false);
  const long = review.comment.length > 180;
  return (
    <article className="review-card">
      <header>
        <span className="review-avatar" aria-hidden="true">{review.author.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{review.author}</strong>
          <span>hillGPX contributor</span>
        </div>
      </header>
      <p className="review-meta"><Stars value={review.rating} /> · {formatDate(review.createdAt)}</p>
      {review.comment && <p className={`review-text${long && !expanded ? ' clamped' : ''}`}>{review.comment}</p>}
      {long && <button type="button" className="review-more" onClick={() => setExpanded((v) => !v)}>{expanded ? 'Show less' : 'Show more'}</button>}
      <button type="button" className="review-report" onClick={() => requestReport({ targetType: 'review', targetSlug: review.id, targetName: `${review.author}'s review` })}>
        Report
      </button>
    </article>
  );
}

function ReviewForm({ venue, initialRating, first, onPosted }: { venue: Venue; initialRating: number; first: boolean; onPosted: (review: Review) => void }) {
  const [hover, setHover] = useState(0);
  const [mine, setMine] = useState(initialRating);
  const [comment, setComment] = useState('');
  const [author, setAuthor] = useState(loadAuthor);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = hover || mine;

  const post = async () => {
    setSubmitting(true);
    setError(null);
    saveAuthor(author);
    try {
      onPosted(await submitReview({ venueSlug: venue.slug, rating: mine, comment, author }));
      setDone(true);
    } catch (err) {
      setError(`Could not post your review: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) return <p className="review-thanks">Thanks — your review is live.</p>;
  return (
    <div className="review-form inline">
      <h3>{first ? 'Be the first to review it' : 'Your review'}</h3>
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
            <StarIcon size={26} filled={value <= shown} />
          </button>
        ))}
        <span className="rate-word">{RATING_WORDS[shown]}</span>
      </div>
      <textarea className="review-comment" placeholder="How was it? Access, shade, water, best time to go (optional)" rows={2} value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} />
      <div className="review-form-row">
        <input className="review-author" type="text" placeholder="Your name (optional)" value={author} maxLength={60} onChange={(event) => setAuthor(event.target.value)} />
        <button type="button" className="btn btn-dark" disabled={mine === 0 || submitting} onClick={() => void post()}>{submitting ? 'Posting…' : 'Post review'}</button>
      </div>
      {error && <p className="review-error">{error}</p>}
    </div>
  );
}

const REVIEWS_SHOWN = 6;

/** Airbnb's reviews block: the score as the heading, a grid of short cards, then "Show all". */
function ReviewsSection({ venue, reviews, rating, initialRating, onPosted, sectionRef }: { venue: Venue; reviews: Review[]; rating: { average: number; count: number } | undefined; initialRating: number; onPosted: (review: Review) => void; sectionRef: React.RefObject<HTMLElement> }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <section className="venue-detail-section reviews-section" ref={sectionRef} id="reviews">
      <div className="reviews-head">
        <h2>
          {rating ? <><StarIcon size={18} filled /> {rating.average.toFixed(2)} · {rating.count} review{rating.count === 1 ? '' : 's'}</> : 'Reviews'}
        </h2>
      </div>
      {reviews.length > 0 && (
        <div className="review-grid">
          {reviews.slice(0, REVIEWS_SHOWN).map((review) => <ReviewCard key={review.id} review={review} />)}
        </div>
      )}
      {reviews.length > REVIEWS_SHOWN && (
        <button type="button" className="reviews-all" onClick={() => setShowAll(true)}>Show all {reviews.length} reviews</button>
      )}
      <ReviewForm key={initialRating} venue={venue} initialRating={initialRating} first={reviews.length === 0} onPosted={onPosted} />
      {showAll && (
        <Modal title={`${reviews.length} reviews`} onClose={() => setShowAll(false)} wide>
          <div className="review-grid single">{reviews.map((review) => <ReviewCard key={review.id} review={review} />)}</div>
        </Modal>
      )}
    </section>
  );
}

/** The side card: what you need right before you go — conditions now, light, and getting there. */
function PlanCard({ venue }: { venue: Venue }) {
  const [conditions, setConditions] = useState<Conditions | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void venueConditions(venue).then((value) => {
      if (!cancelled) setConditions(value);
    });
    return () => {
      cancelled = true;
    };
  }, [venue]);

  return (
    <div className="plan-card">
      <p className="plan-kicker">Conditions now{venue.type === 'hill' ? ' at the summit' : ''}</p>
      {conditions === undefined ? (
        <div className="plan-weather loading" aria-busy="true" />
      ) : conditions ? (
        <>
          <div className="plan-weather">
            <strong>{conditions.temperatureC}°</strong>
            <div>
              <span>{conditions.summary}</span>
              <span className="muted">Feels {conditions.feelsLikeC}° · Wind {conditions.windKmh} km/h</span>
            </div>
          </div>
          <dl className="plan-facts">
            <div><dt>Rain today</dt><dd>{conditions.rainChance != null ? `${conditions.rainChance}%` : '—'}</dd></div>
            <div><dt>Sunrise</dt><dd>{conditions.sunrise ?? '—'}</dd></div>
            <div><dt>Sunset</dt><dd>{conditions.sunset ?? '—'}</dd></div>
          </dl>
        </>
      ) : (
        <p className="muted">Weather is unavailable right now.</p>
      )}
      <a className="venue-primary-action" href={directionsUrl(venue)} target="_blank" rel="noreferrer"><MapIcon size={16} />Get directions</a>
      <p className="plan-credit">Weather by <a href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a></p>
    </div>
  );
}

const MAX_PHOTOS = 12;

interface PendingPhoto {
  id: string;
  file: File;
  url: string;
  status: 'ready' | 'uploading' | 'done' | 'failed';
}

/**
 * Several photos at once: drop or pick them, keep adding more, remove any
 * before sending. Each tile shows its own progress, and a failed one stays
 * behind to retry while the rest are already through.
 */
function AddPhotosModal({ venue, onClose, onUploaded }: { venue: Venue; onClose: () => void; onUploaded: () => void }) {
  const [items, setItems] = useState<PendingPhoto[]>([]);
  const [credit, setCredit] = useState(loadAuthor);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => () => itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url)), []);

  const add = (list: FileList | null) => {
    const known = new Set(items.map((item) => `${item.file.name}:${item.file.size}`));
    const images = [...(list ?? [])].filter((file) => file.type.startsWith('image/') && !known.has(`${file.name}:${file.size}`));
    if (images.length === 0) return;
    const room = MAX_PHOTOS - items.length;
    setError(images.length > room ? `Up to ${MAX_PHOTOS} photos at a time. Send these, then add more.` : null);
    const fresh = images
      .slice(0, Math.max(0, room))
      .map((file): PendingPhoto => ({ id: `${file.name}:${file.size}:${file.lastModified}`, file, url: URL.createObjectURL(file), status: 'ready' }));
    setItems([...items, ...fresh]);
  };

  const remove = (id: string) =>
    setItems((current) => {
      const gone = current.find((item) => item.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return current.filter((item) => item.id !== id);
    });

  const setStatus = (id: string, status: PendingPhoto['status']) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));

  const upload = async () => {
    setBusy(true);
    setError(null);
    saveAuthor(credit);
    let failed = 0;
    for (const item of items.filter((entry) => entry.status !== 'done')) {
      setStatus(item.id, 'uploading');
      try {
        await submitPhoto({ venueSlug: venue.slug, file: item.file, credit, licence: 'CC BY-SA 4.0', author: credit });
        setStatus(item.id, 'done');
      } catch (err) {
        failed += 1;
        setStatus(item.id, 'failed');
        setError((err as Error).message);
      }
    }
    if (failed) setError((message) => `${failed} photo${failed === 1 ? '' : 's'} did not upload${message ? `: ${message}` : ''}. Try again.`);
    setBusy(false);
    onUploaded();
  };

  const sent = items.filter((item) => item.status === 'done').length;
  const toSend = items.length - sent;
  const finished = items.length > 0 && toSend === 0 && !busy;
  const uploadingIndex = items.findIndex((item) => item.status === 'uploading');

  const picker = (className: string, content: ReactNode) => (
    <label
      className={`${className}${dragging ? ' dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        add(event.dataTransfer.files);
      }}
    >
      {content}
      <input
        type="file"
        accept="image/*"
        multiple
        disabled={busy}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
    </label>
  );

  return (
    <Modal
      title="Add photos"
      onClose={onClose}
      footer={finished ? (
        <button type="button" className="btn btn-dark" onClick={onClose}>Done</button>
      ) : (
        <>
          <span className="photo-count">{items.length === 0 ? `Up to ${MAX_PHOTOS} photos` : `${items.length} of ${MAX_PHOTOS} selected`}</span>
          <button type="button" className="btn btn-accent" disabled={toSend === 0 || busy} onClick={() => void upload()}>
            {busy ? `Uploading ${uploadingIndex + 1} of ${items.length}…` : `Upload ${toSend || ''} photo${toSend === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    >
      {finished ? (
        <div className="photo-done">
          <span className="photo-done-icon"><CheckIcon size={22} /></span>
          <h3>Thank you</h3>
          <p>{sent} photo{sent === 1 ? ' is' : 's are'} now on {venue.name}'s page.</p>
        </div>
      ) : (
        <div className="photo-form">
          {items.length === 0 ? (
            picker('photo-upload', (
              <>
                <CameraGlyph size={30} />
                <strong>Drag photos here</strong>
                <span>or <u>choose from your device</u>. The trailhead, the stairs and the view all help.</span>
              </>
            ))
          ) : (
            <ul className="photo-picks" aria-label="Photos to upload">
              {items.map((item) => (
                <li key={item.id} className={`photo-pick ${item.status}`}>
                  <img src={item.url} alt="" />
                  {item.status === 'uploading' && <span className="photo-pick-state" aria-label="Uploading"><span className="spinner" /></span>}
                  {item.status === 'done' && <span className="photo-pick-state" aria-label="Uploaded"><CheckIcon size={16} /></span>}
                  {item.status === 'failed' && <span className="photo-pick-state failed" aria-label="Failed">!</span>}
                  {(item.status === 'ready' || item.status === 'failed') && !busy && (
                    <button type="button" className="photo-pick-remove" aria-label="Remove photo" onClick={() => remove(item.id)}>
                      <CloseIcon size={10} />
                    </button>
                  )}
                </li>
              ))}
              {items.length < MAX_PHOTOS && !busy && (
                <li>{picker('photo-pick-add', <><PlusIcon /><span>Add more</span></>)}</li>
              )}
            </ul>
          )}
          <label className="field">
            <span>Credit as</span>
            <input value={credit} maxLength={60} onChange={(event) => setCredit(event.target.value)} placeholder="Your name or handle" />
          </label>
          <p className="photo-note">Photos appear straight away under the <a href="#terms">house rules</a>; anything reported by several people is hidden. Shared under CC BY-SA 4.0 with your credit; location data is removed.</p>
          {error && <p className="review-error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

interface VenueDetailProps {
  venue: Venue;
  routes: Route[];
  allVenues: Venue[];
  /**
   * Unused: the page opens in its own tab and has no back. Kept optional so
   * callers that still pass it compile.
   */
  onClose?: () => void;
  /** Leave this page for the map, framed on the place (or on one of its routes). */
  onShowOnMap: (routeSlug?: string) => void;
  /** The header's centre. Defaults to the site search over `allVenues`. */
  headerCenter?: ReactNode;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onRemoveLocalRoute: (slug: string) => void;
}


function CameraGlyph({ size = 34 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7h4l1.5-2h7L17 7h4v12H3V7Z" /><circle cx="12" cy="13" r="4" /></svg>;
}

/** A trace between two points: the empty-routes icon, in the same stroke style as the others. */
function RouteGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="18" r="2.2" />
      <path d="M18 3.5c-1.9 0-3.4 1.5-3.4 3.3 0 2.4 3.4 5.7 3.4 5.7s3.4-3.3 3.4-5.7c0-1.8-1.5-3.3-3.4-3.3z" />
      <circle cx="18" cy="6.8" r="1" />
      <path d="M8.2 18H15a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h1.5" />
    </svg>
  );
}

/**
 * A nearby place's cover. With no stored photo, a hill gets the same picture
 * its own page leads with (its summit photo, else the first open-licence
 * photo taken nearby), so the card and the page agree. Both lookups are
 * cached, so opening the place afterwards costs nothing.
 */
function NearbyThumb({ venue }: { venue: Venue }) {
  const [cover, setCover] = useState<{ slug: string; url: string } | null>(null);
  const needsLookup = venuePhotos(venue).length === 0 && !BUILT_TYPES.has(venue.type);
  useEffect(() => {
    if (!needsLookup) return;
    let cancelled = false;
    const lead = isWorldPeakSlug(venue.slug) ? loadPeakPhotos().then((photos) => photos.get(venue.slug)?.url) : Promise.resolve(undefined);
    lead
      .then((url) => url ?? commonsPhotos(venue).then((photos) => photos[0]?.url))
      .then((url) => {
        if (!cancelled && url) setCover({ slug: venue.slug, url });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [needsLookup, venue]);
  if (cover?.slug === venue.slug) {
    return (
      <span className="card-thumb">
        <FadeImage src={cover.url} alt={venue.name} loading="lazy" decoding="async" onError={() => setCover(null)} />
      </span>
    );
  }
  return <VenueThumb venue={venue} />;
}

function aboutFallback(venue: Venue, typeLabel: string, area: string | null, heightText: string, routeCount: number): string {
  const where = area ? ` in ${area}` : '';
  if (venue.type === 'hdb_block') {
    return `A ${venue.storeys ?? ''}-storey residential block${where}, climbed by its public stairwell. ${heightText} from the ground floor to the top landing. Check the stairwell is open before you go and keep noise down for residents.`.replace('  ', ' ');
  }
  const routes = routeCount > 0 ? `${routeCount} shared route${routeCount === 1 ? '' : 's'} pass${routeCount === 1 ? 'es' : ''} here.` : 'No one has shared a route up it yet.';
  return `${typeLabel}${where}, ${heightText}. ${routes}`;
}

function VenueDetailInner({
  venue,
  routes,
  allVenues,
  onShowOnMap,
  headerCenter,
  isFavorite,
  onToggleFavorite,
  onRemoveLocalRoute,
}: VenueDetailProps) {
  const units = useUnits();
  const [copied, setCopied] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(false);
  const [aboutOverflows, setAboutOverflows] = useState(false);
  const aboutRef = useRef<HTMLDivElement>(null);
  const [addingPhotos, setAddingPhotos] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [quickRating, setQuickRating] = useState(0);
  const copyTimer = useRef<number | null>(null);
  const reviewsRef = useRef<HTMLElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  useReveal(pageRef, venue.slug);
  // The page is a fixed layer over the map page. Locking the map page behind
  // it leaves one scrollbar (this page's own), so the header lines up with
  // every other page and does not shift when a dialog opens.
  useEffect(() => lockPageScroll(), []);
  const { reviews, setReviews, communityPhotos, reloadPhotos, commons, wiki, generated } = useVenueContent(venue);
  const narrow = useNarrow();
  const height = venueHeight(venue);
  const typeLabel = venueKindLabel(venue);
  const area = townName(venue.town) ?? regionOf(venue.lng, venue.lat);
  const street = venue.street ? titleCaseStreet(venue.street) : null;
  const address = [venue.blkNo ? titleCaseStreet(venue.blkNo) : null, street].filter(Boolean).join(' ');
  const heightText = height ? `${units.height(height.value)} ${HEIGHT_LABEL[height.kind]}` : 'height not recorded';
  const rating = combinedRating(venue.rating, reviews);
  const nearby = useMemo(
    () => tallestWithin(allVenues, venue.lng, venue.lat, 1000, 7).filter((item) => item.venue.slug !== venue.slug).slice(0, 6),
    [allVenues, venue],
  );

  // The stored cover first, as on every card; then the rest of the stored
  // gallery, community photos, and Commons photos taken nearby. The same file
  // from two sources appears once.
  const photos: GalleryPhoto[] = useMemo(() => {
    const seen = new Set<string>();
    const unique = (photo: GalleryPhoto) => {
      if (photo.keys.some((key) => seen.has(key))) return false;
      photo.keys.forEach((key) => seen.add(key));
      return true;
    };
    return [
      ...venuePhotos(venue).map(storedGalleryPhoto),
      ...communityPhotos.map((photo): GalleryPhoto => ({ key: photo.id, src: photo.url, credit: photo.credit, licence: photo.licence, keys: [photoKey(photo.url)], communityId: photo.id })),
      ...commons,
    ].filter(unique);
  }, [venue, communityPhotos, commons]);

  const about = generated?.text ?? wiki?.extract ?? aboutFallback(venue, typeLabel, area, heightText, routes.length);

  // Only offer "Read more" when three lines actually cut the text off.
  useLayoutEffect(() => {
    const el = aboutRef.current;
    if (el && !aboutExpanded) setAboutOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [about, aboutExpanded]);

  useEffect(() => () => {
    if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
  }, []);

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: venue.name, url }).catch(() => undefined);
    else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const iconActions = (
    <div className="venue-icon-actions">
      <button type="button" className={`icon-action${isFavorite ? ' on' : ''}`} aria-label={isFavorite ? 'Saved' : 'Save'} title={isFavorite ? 'Saved' : 'Save'} onClick={onToggleFavorite}>
        <HeartIcon size={18} filled={isFavorite} />
      </button>
      <button type="button" className="icon-action" aria-label={copied ? 'Link copied' : 'Copy link'} title={copied ? 'Link copied' : 'Copy link'} onClick={() => void share()}>
        {copied ? <CheckIcon size={16} /> : <LinkIcon />}
      </button>
    </div>
  );

  const heightBlock = height ? <><strong>{units.height(height.value)}</strong> {HEIGHT_LABEL[height.kind]}</> : 'Height not recorded';

  return createPortal(
    <div className="venue-detail" ref={pageRef}>
      {/* A page of its own (cards open it in a new tab): the site header with
          search on top, no back button. */}
      <SiteHeader
        center={headerCenter ?? (
          <SearchBar
            venues={allVenues}
            onPick={(slug) => (window.location.hash = `#venue/${slug}`)}
            onFitBounds={(bounds) => (window.location.hash = boundsToHash(bounds))}
          />
        )}
      />

      <main className="venue-detail-content">
        <div className="venue-detail-title-row">
          <div>
            <h1>{venue.name}</h1>
            <p className="venue-detail-sub">
              <button type="button" className="venue-rating-link" onClick={() => reviewsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                {rating ? (
                  <><StarIcon size={12} filled /> {rating.average.toFixed(2)} · <u>{rating.count} review{rating.count === 1 ? '' : 's'}</u></>
                ) : (
                  <RatingLabel />
                )}
              </button>
              <span aria-hidden="true"> · </span>
              {area ? `${typeLabel} in ${area}` : typeLabel}
            </p>
          </div>
          {!narrow && (
            <div className="venue-detail-title-actions">
              <button type="button" onClick={() => void share()} aria-label={copied ? 'Link copied' : 'Share'}>
                {copied ? <CheckIcon size={16} /> : <LinkIcon />}
                <span className="venue-action-label">{copied ? 'Link copied' : 'Share'}</span>
              </button>
              <button type="button" className={isFavorite ? 'on' : undefined} onClick={onToggleFavorite} aria-label={isFavorite ? 'Saved' : 'Save'} aria-pressed={isFavorite}>
                <HeartIcon size={16} filled={isFavorite} />
                <span className="venue-action-label">{isFavorite ? 'Saved' : 'Save'}</span>
              </button>
            </div>
          )}
        </div>

        {photos.length === 0 ? (
          <NoPhotos venue={venue} onAdd={() => setAddingPhotos(true)} actions={narrow ? iconActions : undefined} />
        ) : narrow ? (
          <PhotoCarousel photos={photos} onAdd={() => setAddingPhotos(true)} actions={iconActions} />
        ) : (
          <PhotoGrid photos={photos} venueName={venue.name} onAdd={() => setAddingPhotos(true)} />
        )}

        <div className="venue-detail-layout">
          <div className="venue-detail-main">
            <section className="venue-detail-intro">
              <div className="venue-intro-row">
                <h2>{heightBlock}</h2>
                <div className="quick-rate" role="radiogroup" aria-label="Rate this place">
              <span>Rate it</span>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={quickRating === value}
                  aria-label={`${value} star${value === 1 ? '' : 's'}`}
                  className={value <= quickRating ? 'on' : ''}
                  onClick={() => {
                    setQuickRating(value);
                    window.setTimeout(() => reviewsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
                  }}
                >
                  <StarIcon size={18} filled={value <= quickRating} />
                </button>
              ))}
            </div>
              </div>
              {(venue.storeys || address) && <p>{[venue.storeys ? `${venue.storeys} floors` : null, address || null].filter(Boolean).join(' · ')}</p>}
            </section>

            <section className="venue-detail-section">
              <h2>About this place</h2>
              {/* Three lines; a clear "Read more" (or a double-click) opens the rest. */}
              <div
                ref={aboutRef}
                className={`venue-about-copy${aboutExpanded ? '' : ' clamp3'}`}
                onDoubleClick={() => setAboutExpanded((value) => !value)}
              >
                <p>{about}</p>
                {venue.notes && !venue.notes.startsWith('Summit elevation from') && <p>{venue.notes}</p>}
              </div>
              {(aboutOverflows || aboutExpanded) && (
                <button type="button" className="venue-read-more" aria-expanded={aboutExpanded} onClick={() => setAboutExpanded((value) => !value)}>
                  {aboutExpanded ? 'Show less' : 'Read more'}
                  <ChevronRightIcon size={12} />
                </button>
              )}
              <p className="venue-about-source">
                {generated
                  ? `Summarised from ${generated.sources.join(', ')}`
                  : wiki
                    ? <>From <a href={wiki.url} target="_blank" rel="noreferrer">Wikipedia</a>, CC BY-SA</>
                    : 'Know this place? Add a review below and it shapes this description.'}
              </p>
            </section>

            <section className="venue-detail-section venue-routes-section">
              <h2>Routes that pass here</h2>
              {routes.length > 0 ? (
                  <div className="venue-route-grid">
                    {routes.map((route) => (
                      <article className="venue-route-card" key={route.slug} tabIndex={0} aria-label={route.name}>
                        <RouteThumb route={route} />
                        <div className="venue-route-tools">
                          <button type="button" className="venue-route-tool" aria-label="Show on map" data-tip="Show on map" onClick={() => onShowOnMap(route.slug)}>
                            <MapIcon size={15} />
                          </button>
                          <button type="button" className="venue-route-tool" aria-label="Download GPX" data-tip="Download GPX" onClick={() => downloadRoute(route)}>
                            <DownloadIcon size={15} />
                          </button>
                          {route.source === 'local' && (
                            <button type="button" className="venue-route-tool" aria-label="Remove from this device" data-tip="Remove" onClick={() => onRemoveLocalRoute(route.slug)}>
                              <CloseIcon size={12} />
                            </button>
                          )}
                        </div>
                        <div className="venue-route-caption">
                          <h3>{route.name}</h3>
                          <p>
                            {ACTIVITY_LABEL[routeActivity(route)]} · {units.distance(route.distanceM)}
                            {route.source === 'local' ? ' · on this device' : ''}
                          </p>
                        </div>
                        {/* Hover (or focus, or a tap on touch screens) lifts the details over the map. */}
                        <div className="venue-route-details">
                          <dl>
                            <div><dt>Distance</dt><dd>{units.distance(route.distanceM)}</dd></div>
                            <div><dt>EG</dt><dd>{routeHasElevation(route) ? units.height(route.gainM) : '—'}</dd></div>
                            <div><dt>EL</dt><dd>{routeHasElevation(route) ? units.height(route.lossM) : '—'}</dd></div>
                          </dl>
                          {routeHasElevation(route) && <ElevationProfile points={route.coordinates} height={44} />}
                        </div>
                      </article>
                    ))}
                  </div>
              ) : (
                <div className="venue-empty">
                  <span className="venue-empty-icon" aria-hidden="true"><RouteGlyph /></span>
                  <div className="venue-empty-copy">
                    <h3>No GPX here yet</h3>
                    <p>Been up {venue.name}? Share the file from your watch or app and anyone can download it.</p>
                  </div>
                  <a className="btn btn-dark venue-empty-btn" href="#import" onClick={openImportHere}><UploadIcon size={15} />Upload a GPX</a>
                </div>
              )}
            </section>

            <ReviewsSection venue={venue} reviews={reviews} rating={rating} initialRating={quickRating} sectionRef={reviewsRef} onPosted={(review) => setReviews((current) => [review, ...current])} />

            {nearby.length > 0 && (
              <section className="venue-detail-section">
                <div className="venue-section-heading"><h2>Nearby</h2><span>Within 1 km</span></div>
                <div className="nearby-grid">
                  {nearby.map(({ venue: item }) => {
                    const itemHeight = venueHeight(item);
                    return (
                      <a className="nearby-card" href={`#venue/${item.slug}`} target="_blank" rel="noopener" key={item.slug}>
                        <NearbyThumb venue={item} />
                        <strong>{item.name}</strong>
                        <span>{venueKindLabel(item)}{itemHeight ? ` · ${units.height(itemHeight.value)} ${HEIGHT_LABEL[itemHeight.kind]}` : ''}</span>
                      </a>
                    );
                  })}
                </div>
              </section>
            )}

            <section className="venue-detail-section venue-location-section">
              <h2>Where it is</h2>
              <div className="mini-map-frame">
                <Suspense fallback={<div className="mini-map mini-map-fallback" />}><MiniMap venue={venue} /></Suspense>
                <button type="button" className="mini-map-open" onClick={() => onShowOnMap()}><MapIcon size={14} />Open in map</button>
              </div>
            </section>
          </div>

          <aside className="venue-detail-side">
            <PlanCard venue={venue} />
            <button type="button" className="plan-report side" onClick={() => setReporting(true)}><FlagIcon />Report an issue with this place</button>
          </aside>
        </div>
      </main>
      <SiteFooter />

      <div className="venue-mobile-bar">
        <button type="button" className="venue-mobile-secondary" onClick={() => onShowOnMap()}>Show on map</button>
        <a className="venue-mobile-primary" href={directionsUrl(venue)} target="_blank" rel="noreferrer"><MapIcon size={16} />Directions</a>
      </div>

      {/* Outside the page layer: it slides in with a transform, which would
          carry a fixed badge along with it for the length of the animation. */}
      {createPortal(<OpenSourceBadge placement="corner" />, document.body)}
      {addingPhotos && <AddPhotosModal venue={venue} onClose={() => setAddingPhotos(false)} onUploaded={reloadPhotos} />}
      {reporting && <ReportModal targetType="venue" targetSlug={venue.slug} targetName={venue.name} onClose={() => setReporting(false)} />}
    </div>,
    document.body,
  );
}

/**
 * The place page's shape while its data loads: header, a title line, the
 * photo frame and a few lines, so a card opened in a new tab lands on the
 * place page straight away instead of showing the map page first.
 */
export function VenueDetailSkeleton() {
  useEffect(() => lockPageScroll(), []);
  return createPortal(
    <div className="venue-detail venue-detail-loading" aria-busy="true" aria-label="Loading place">
      <SiteHeader center={<SearchBar venues={[]} onPick={(slug) => (window.location.hash = `#venue/${slug}`)} onFitBounds={(bounds) => (window.location.hash = boundsToHash(bounds))} />} />
      <main className="venue-detail-content">
        <div className="sk-line sk-title" />
        <div className="sk-line sk-sub" />
        <div className="sk-photo" />
        <div className="sk-line" />
        <div className="sk-line" />
        <div className="sk-line sk-short" />
      </main>
    </div>,
    document.body,
  );
}

/**
 * The venue page. App can hand over a fresh object for the same place (map
 * tiles reload), so the page pins one venue per slug: content is fetched once
 * per place, and a new slug remounts the page at the top.
 */
export function VenueDetail(props: VenueDetailProps) {
  const [venue, setVenue] = useState(props.venue);
  if (venue.slug !== props.venue.slug) setVenue(props.venue);
  const current = venue.slug === props.venue.slug ? venue : props.venue;
  return <VenueDetailInner key={current.slug} {...props} venue={current} />;
}
