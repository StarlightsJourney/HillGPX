import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import type { Route, Venue } from '../types';
import { HEIGHT_LABEL, photoSrc, tallestWithin, titleCaseStreet, townName, venueHeight, venueKindLabel } from '../lib/venues';
import { useUnits } from './UnitsContext';
import { ElevationProfile } from './ElevationProfile';
import { VenueThumb } from './VenueThumb';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, HeartIcon, MapIcon, StarIcon, UploadIcon } from './icons';
import { FlagIcon, LinkIcon, PlusIcon, ReportModal } from './ReportModal';
import { useReveal } from './useReveal';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { directionsUrl, venueConditions, type Conditions } from '../lib/conditions';
import { downloadRoute } from './VenueCard';
import { RouteThumb } from './RouteThumb';
import { Modal } from './Modal';
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
import { regionOf } from '../lib/regions';
import { routeHasElevation } from '../lib/routes';
import { ACTIVITY_LABEL, routeActivity } from '../lib/routeAnalysis';
import { isWorldPeakSlug, loadPeakPhotos } from '../lib/worldPeaks';
import { commonsPhotos, generatedDescription, wikiSummary, type GeneratedDescription, type WikiSummary } from '../lib/wiki';

const MiniMap = lazy(() => import('./MiniMap').then((module) => ({ default: module.MiniMap })));

const RATING_WORDS = ['', 'Not worth it', 'Meh', 'Solid', 'Great session', 'Must do'];

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
}

/**
 * The stored files are 420 px card thumbnails, soft at page width. Commons
 * photos are fetched sharp straight from Wikimedia (Special:FilePath scales on
 * request); Mapillary originals are not kept, so those stay at card size.
 */
function sharpPhoto(sourceUrl: string | undefined): string | undefined {
  const match = sourceUrl ? /commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/.exec(sourceUrl) : null;
  return match ? `https://commons.wikimedia.org/wiki/Special:FilePath/${match[1].slice('File:'.length)}?width=1280` : undefined;
}

function useVenueContent(venue: Venue) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [communityPhotos, setCommunityPhotos] = useState<CommunityPhoto[]>([]);
  const [commons, setCommons] = useState<GalleryPhoto[]>([]);
  const [wiki, setWiki] = useState<WikiSummary | null>(null);
  const [generated, setGenerated] = useState<GeneratedDescription | null>(null);
  // A world summit's photo is a Commons link, so the page still looks for more nearby.
  const hasPublishedPhoto = Boolean(venue.photo?.file) && !isWorldPeakSlug(venue.slug);

  useEffect(() => {
    let cancelled = false;
    const guard = <T,>(set: (value: T) => void) => (value: T) => {
      if (!cancelled) set(value);
    };
    fetchReviews(venue.slug).then(guard(setReviews)).catch(() => undefined);
    fetchPhotos(venue.slug).then(guard(setCommunityPhotos)).catch(() => undefined);
    wikiSummary(venue).then(guard(setWiki)).catch(() => undefined);
    generatedDescription(venue.slug).then(guard(setGenerated)).catch(() => undefined);
    if (!hasPublishedPhoto) {
      // The landing's stored summit photo first, then anything else on Commons nearby.
      Promise.all([loadPeakPhotos(), commonsPhotos(venue)])
        .then(([stored, nearby]) => {
          const storedPhoto = stored.get(venue.slug);
          const rest = nearby.filter((photo) => photo.url !== storedPhoto?.url);
          // Already in the gallery as the venue's own photo.
          const lead = venue.photo ? undefined : storedPhoto;
          return lead ? [{ url: lead.url, pageUrl: lead.pageUrl, artist: lead.credit, licence: lead.licence }, ...rest] : rest;
        })
        .then((photos) => photos.map((photo, i) => ({
          key: `commons-${i}`,
          src: photo.url,
          credit: photo.artist,
          creditUrl: photo.pageUrl,
          licence: `${photo.licence} · Wikimedia Commons`,
        })))
        .then(guard(setCommons))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [venue, hasPublishedPhoto]);

  return { reviews, setReviews, communityPhotos, commons, wiki, generated };
}

const AUTOPLAY_MS = 5000;

/**
 * One photo at a time, with arrows on either side, a counter, and gentle
 * auto-advance that pauses while you are hovering or have interacted — the
 * Airbnb listing carousel. Tapping the photo opens the same carousel full screen.
 */
function PhotoCarousel({ photos, venueName, onAdd, actions }: { photos: GalleryPhoto[]; venueName: string; onAdd: () => void; actions: React.ReactNode }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const count = photos.length;
  const go = (delta: number) => setIndex((i) => (i + delta + count) % count);

  useEffect(() => {
    if (count < 2 || paused || fullscreen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [count, paused, fullscreen]);

  if (count === 0) {
    return (
      <div className="venue-gallery-empty">
        <div className="carousel-actions">{actions}</div>
        <CameraGlyph />
        <strong>No photos yet</strong>
        <p>Been here? A photo of the trailhead or the view helps the next person.</p>
        <button type="button" className="btn btn-dark" onClick={onAdd}>Add a photo</button>
      </div>
    );
  }

  return (
    <>
      <div
        className="carousel"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onTouchStart={() => setPaused(true)}
      >
        <Slides photos={photos} index={index} onIndex={setIndex} onOpen={() => setFullscreen(true)} venueName={venueName} />
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
        <p className="carousel-credit">
          Photo by {photos[index].creditUrl ? <a href={photos[index].creditUrl} target="_blank" rel="noreferrer">{photos[index].credit}</a> : photos[index].credit}
          {photos[index].licence ? ` · ${photos[index].licence}` : ''}
        </p>
      </div>
      {fullscreen && <Lightbox photos={photos} index={index} onIndex={setIndex} onClose={() => setFullscreen(false)} />}
    </>
  );
}

/** A horizontal strip that snaps one photo per view: swipe on touch, arrows elsewhere. */
function Slides({ photos, index, onIndex, onOpen, venueName }: { photos: GalleryPhoto[]; index: number; onIndex: (i: number) => void; onOpen?: () => void; venueName: string }) {
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
        <button type="button" key={photo.key} className="carousel-slide" onClick={onOpen} aria-label={onOpen ? `Open photo ${i + 1} of ${venueName} full screen` : undefined} tabIndex={onOpen ? 0 : -1}>
          <img
            src={photo.src}
            alt=""
            loading={Math.abs(i - index) <= 1 ? 'eager' : 'lazy'}
            decoding="async"
            onError={(event) => {
              if (photo.fallback && event.currentTarget.src !== photo.fallback) event.currentTarget.src = photo.fallback;
            }}
          />
        </button>
      ))}
    </div>
  );
}

function Lightbox({ photos, index, onIndex, onClose }: { photos: GalleryPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const count = photos.length;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') onIndex((index + 1) % count);
      if (event.key === 'ArrowLeft') onIndex((index - 1 + count) % count);
    };
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [index, count, onIndex, onClose]);

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photos">
      <header className="lightbox-head">
        <button type="button" onClick={onClose} aria-label="Close photos"><CloseIcon size={14} />Close</button>
        <span>{index + 1} / {count}</span>
      </header>
      <div className="lightbox-stage">
        <Slides photos={photos} index={index} onIndex={onIndex} venueName="" />
        {count > 1 && (
          <>
            <button type="button" className="carousel-arrow prev" aria-label="Previous photo" onClick={() => onIndex((index - 1 + count) % count)}><ChevronLeftIcon size={18} /></button>
            <button type="button" className="carousel-arrow next" aria-label="Next photo" onClick={() => onIndex((index + 1) % count)}><ChevronRightIcon size={18} /></button>
          </>
        )}
      </div>
      <p className="lightbox-credit">
        Photo by {photos[index].creditUrl ? <a href={photos[index].creditUrl} target="_blank" rel="noreferrer">{photos[index].credit}</a> : photos[index].credit}
        {photos[index].licence ? ` · ${photos[index].licence}` : ''}
      </p>
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
    </article>
  );
}

function ReviewForm({ venue, initialRating, onPosted }: { venue: Venue; initialRating: number; onPosted: (review: Review) => void }) {
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
      <h3>Your review</h3>
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
      <textarea className="review-comment" placeholder="Gates, water, shade, best time to go (optional)" rows={2} value={comment} maxLength={1000} onChange={(event) => setComment(event.target.value)} />
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
          {rating ? <><StarIcon size={18} filled /> {rating.average.toFixed(2)} · {rating.count} review{rating.count === 1 ? '' : 's'}</> : 'No reviews yet'}
        </h2>
      </div>
      {reviews.length === 0 ? (
        <p className="muted">Trained here? Tell others about access, shade, water and the best time to go.</p>
      ) : (
        <div className="review-grid">
          {reviews.slice(0, REVIEWS_SHOWN).map((review) => <ReviewCard key={review.id} review={review} />)}
        </div>
      )}
      {reviews.length > REVIEWS_SHOWN && (
        <button type="button" className="reviews-all" onClick={() => setShowAll(true)}>Show all {reviews.length} reviews</button>
      )}
      <ReviewForm key={initialRating} venue={venue} initialRating={initialRating} onPosted={onPosted} />
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

function AddPhotosModal({ venue, onClose }: { venue: Venue; onClose: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [credit, setCredit] = useState(loadAuthor);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(event.target.files ?? [])].filter((file) => file.type.startsWith('image/')).slice(0, 8);
    setFiles(picked);
    setPreviews(picked.map((file) => URL.createObjectURL(file)));
    setError(null);
  };

  const upload = async () => {
    setBusy(true);
    setError(null);
    saveAuthor(credit);
    let count = 0;
    try {
      for (const file of files) {
        await submitPhoto({ venueSlug: venue.slug, file, credit, licence: 'CC BY-SA 4.0', author: credit });
        count += 1;
        setDone(count);
      }
    } catch (err) {
      setError(`Uploaded ${count} of ${files.length}. ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const finished = done === files.length && files.length > 0 && !busy && !error;

  return (
    <Modal
      title={`Add photos of ${venue.name}`}
      onClose={onClose}
      footer={finished ? (
        <button type="button" className="btn btn-dark" onClick={onClose}>Done</button>
      ) : (
        <button type="button" className="btn btn-accent" disabled={files.length === 0 || busy} onClick={() => void upload()}>
          {busy ? `Uploading ${done + 1} of ${files.length}…` : `Upload ${files.length || ''} photo${files.length === 1 ? '' : 's'}`}
        </button>
      )}
    >
      {finished ? (
        <p className="review-thanks">Thank you. Your photo{files.length === 1 ? '' : 's'} will appear once a volunteer has had a quick look — usually within a day.</p>
      ) : (
        <div className="photo-form">
          <label className="photo-upload">
            {previews.length > 0 ? (
              <span className="photo-previews">{previews.map((url) => <img key={url} src={url} alt="" />)}</span>
            ) : (
              <>
                <CameraGlyph />
                <strong>Choose photos</strong>
                <span>Up to 8 at a time. Landscape shots of the trail, stairs or view work best.</span>
              </>
            )}
            <input type="file" accept="image/*" multiple onChange={choose} />
          </label>
          <label className="field">
            <span>Credit as</span>
            <input value={credit} maxLength={60} onChange={(event) => setCredit(event.target.value)} placeholder="Your name or handle" />
          </label>
          <p className="photo-note">A volunteer checks every photo before it appears, so nothing unsuitable goes public. Shared under CC BY-SA 4.0 with your credit; location data is removed.</p>
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
  onClose: () => void;
  onShowOnMap: (routeSlug?: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onRemoveLocalRoute: (slug: string) => void;
}


function CameraGlyph() {
  return <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7h4l1.5-2h7L17 7h4v12H3V7Z" /><circle cx="12" cy="13" r="4" /></svg>;
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
  onClose,
  onShowOnMap,
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
  const { reviews, setReviews, communityPhotos, commons, wiki, generated } = useVenueContent(venue);
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

  const photos: GalleryPhoto[] = useMemo(() => {
    const published = venue.photos ?? (venue.photo ? [venue.photo] : []);
    return [
      ...published.map((photo) => {
        const sharp = sharpPhoto(photo.sourceUrl);
        return {
          key: photo.file,
          src: sharp ?? photoSrc(photo),
          fallback: sharp ? photoSrc(photo) : undefined,
          credit: photo.credit ?? (photo.source ?? 'Mapillary'),
          creditUrl: photo.sourceUrl,
          licence: photo.license ?? (photo.source ? undefined : 'CC BY-SA · Mapillary'),
        };
      }),
      ...communityPhotos.map((photo) => ({ key: photo.id, src: photo.url, credit: photo.credit, licence: photo.licence })),
      ...commons,
    ];
  }, [venue, communityPhotos, commons]);

  const about = generated?.text ?? wiki?.extract ?? aboutFallback(venue, typeLabel, area, heightText, routes.length);

  // Only offer "Read more" when three lines actually cut the text off.
  useLayoutEffect(() => {
    const el = aboutRef.current;
    if (el && !aboutExpanded) setAboutOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [about, aboutExpanded]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !addingPhotos && !document.querySelector('.lightbox, .modal-root')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (copyTimer.current != null) window.clearTimeout(copyTimer.current);
    };
  }, [onClose, addingPhotos]);

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

  const heightBlock = height ? <><strong>{units.height(height.value)}</strong> {HEIGHT_LABEL[height.kind]}</> : 'Height not recorded';

  return createPortal(
    <div className="venue-detail" ref={pageRef}>
      <SiteHeader onBack={onClose} />

      <main className="venue-detail-content">
        <div className="venue-detail-title-row">
          <div>
            <h1>{venue.name}</h1>
            <p className="venue-detail-sub">
              {rating && (
                <button type="button" className="venue-rating-link" onClick={() => reviewsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                  <StarIcon size={12} filled /> {rating.average.toFixed(2)} · <u>{rating.count} review{rating.count === 1 ? '' : 's'}</u>
                </button>
              )}
              {rating && <span aria-hidden="true"> · </span>}
              {area ? `${typeLabel} in ${area}` : typeLabel}
            </p>
          </div>
        </div>

        <PhotoCarousel
          key={venue.slug}
          photos={photos}
          venueName={venue.name}
          onAdd={() => setAddingPhotos(true)}
          actions={
            <div className="venue-icon-actions">
            <button type="button" className={`icon-action${isFavorite ? ' on' : ''}`} aria-label={isFavorite ? 'Saved' : 'Save'} title={isFavorite ? 'Saved' : 'Save'} onClick={onToggleFavorite}>
              <HeartIcon size={18} filled={isFavorite} />
            </button>
            <button type="button" className="icon-action" aria-label={copied ? 'Link copied' : 'Copy link'} title={copied ? 'Link copied' : 'Copy link'} onClick={() => void share()}>
              {copied ? <CheckIcon size={16} /> : <LinkIcon />}
            </button>
            </div>
          }
        />

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
              {routes.length > 0 ? (
                <>
                  <h2>Routes that pass here</h2>
                  <div className="venue-route-grid">
                    {routes.map((route) => (
                      <article className="venue-route-card" key={route.slug}>
                        <RouteThumb route={route} />
                        {routeHasElevation(route) && <div className="venue-route-profile"><ElevationProfile points={route.coordinates} height={64} /></div>}
                        <h3>{route.name}</h3>
                        <p>
                          {ACTIVITY_LABEL[routeActivity(route)]} · {units.distance(route.distanceM)}
                          {routeHasElevation(route) ? ` · ${units.height(route.gainM)} EG` : ''}
                          {route.loop ? ' · loop' : ''}
                        </p>
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
                <div className="venue-routes-empty">
                  <h2>No GPX for this place yet</h2>
                  <p>Been up {venue.name}? Upload the GPX from your watch or app and it becomes the first route here. Free for everyone.</p>
                  <a className="btn btn-accent" href="#import"><UploadIcon size={16} />Upload a GPX</a>
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
                    return <a className="nearby-card" href={`#venue/${item.slug}`} key={item.slug}><VenueThumb venue={item} /><strong>{item.name}</strong><span>{venueKindLabel(item)}{itemHeight ? ` · ${units.height(itemHeight.value)} ${HEIGHT_LABEL[itemHeight.kind]}` : ''}</span></a>;
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

      {addingPhotos && <AddPhotosModal venue={venue} onClose={() => setAddingPhotos(false)} />}
      {reporting && <ReportModal targetType="venue" targetSlug={venue.slug} targetName={venue.name} onClose={() => setReporting(false)} />}
    </div>,
    document.body,
  );
}

export const VenueDetail = VenueDetailInner;
