import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Route, Venue } from '../types';
import { VENUE_TYPE_LABEL, tallestWithin, titleCaseStreet, townName, venueHeight } from '../lib/venues';
import { useUnits } from './UnitsContext';
import { ElevationProfile } from './ElevationProfile';
import { PhotoCredit, VenueThumb } from './VenueThumb';
import { ChevronLeftIcon, HeartIcon, Mark } from './icons';
import { HeaderControls } from './HeaderControls';
import { downloadRoute } from './VenueCard';

const MiniMap = lazy(() => import('./MiniMap').then((module) => ({ default: module.MiniMap })));
const REPO_URL = 'https://github.com/StarlightsJourney/HillGPX';

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

function ShareGlyph() {
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 10V1m0 0L4.5 4.5M8 1l3.5 3.5M3 7v7h10V7" /></svg>;
}

function FlagGlyph() {
  return <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 15V2m0 1h8l-1.5 3L11 9H3" /></svg>;
}

function CameraGlyph() {
  return <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7h4l1.5-2h7L17 7h4v12H3V7Z" /><circle cx="12" cy="13" r="4" /></svg>;
}

function PlannerCard({ venue }: { venue: Venue }) {
  const [reps, setReps] = useState(3);
  const height = venueHeight(venue);
  const units = useUnits();
  const total = (height?.value ?? 0) * reps;
  return (
    <section className="venue-plan-card">
      <h2>Plan a session</h2>
      <div className="venue-plan-stepper">
        <span>Reps</span>
        <div>
          <button type="button" onClick={() => setReps((value) => Math.max(1, value - 1))} aria-label="Fewer reps">−</button>
          <strong>{reps}</strong>
          <button type="button" onClick={() => setReps((value) => Math.min(20, value + 1))} aria-label="More reps">+</button>
        </div>
      </div>
      {height ? (
        <div className="venue-plan-result">
          <p>{reps} × {units.height(height.value)} = {units.height(total)} of climbing</p>
          {height.kind === 'gain' ? (
            <p>≈ {Math.round(total / 2.8)} floors</p>
          ) : (
            <p className="muted">Summit height, not the climb from the base.</p>
          )}
        </div>
      ) : <p className="muted">Add a height before planning repetitions.</p>}
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
  const area = townName(venue.town);
  const street = venue.street ? titleCaseStreet(venue.street) : null;
  const address = [venue.blkNo ? titleCaseStreet(venue.blkNo) : null, street].filter(Boolean).join(' ');
  const heightText = height
    ? `${units.height(height.value)} ${height.kind === 'gain' ? 'to climb' : 'above sea level'}`
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
      ? `Height is estimated from ${venue.storeys} storeys × 2.8 m per floor. Climb by the stairwell and check it is open.`
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
    ? venue.storeys ? `Estimated from ${venue.storeys} storeys × 2.8 m` : 'Estimated'
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
          <h1>{venue.name}</h1>
          <div className="venue-detail-title-actions">
            <button type="button" aria-label="Share" onClick={() => void share()}><ShareGlyph /><span className="venue-action-label">{copied ? 'Link copied' : 'Share'}</span></button>
            <button type="button" aria-label="Save" onClick={onToggleFavorite}><HeartIcon size={16} filled={isFavorite} /><span className="venue-action-label">{isFavorite ? 'Saved' : 'Save'}</span></button>
          </div>
        </div>

        {venue.photo?.file ? (
          <div className="venue-detail-gallery">
            <div className="venue-detail-hero"><VenueThumb venue={venue} rounded={false} /></div>
            <PhotoCredit venue={venue} />
          </div>
        ) : (
          <div className="venue-detail-empty-photo">
            <CameraGlyph />
            <strong>No photo yet</strong>
            <p>Add a street-level photo on <a href="https://www.mapillary.com" target="_blank" rel="noreferrer">Mapillary</a> and it will be imported with credit</p>
          </div>
        )}

        <div className="venue-detail-layout">
          <div className="venue-detail-main">
            <section className="venue-detail-intro">
              <h2>{area ? `${typeLabel} in ${area}` : typeLabel}</h2>
              <p>{introMeta}</p>
            </section>

            <section className="venue-detail-section">
              <h2>About this climb</h2>
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
                        <div className="venue-route-profile"><ElevationProfile points={route.coordinates} height={96} /></div>
                        <h3>{route.name}</h3>
                        <p>{units.distance(route.distanceM)} · {units.height(route.gainM)} gain{route.loop ? ' · loop' : ''}</p>
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
              ) : <p className="venue-no-routes">No routes recorded here yet — import a GPX that passes this venue and save it.</p>}
            </section>

            {nearby.length > 0 && (
              <section className="venue-detail-section">
                <div className="venue-section-heading"><h2>Nearby climbs</h2><span>Within 1 km</span></div>
                <div className="nearby-grid">
                  {nearby.map(({ venue: item }) => {
                    const itemHeight = venueHeight(item);
                    return <a className="nearby-card" href={`#venue/${item.slug}`} key={item.slug}><VenueThumb venue={item} /><strong>{item.name}</strong><span>{VENUE_TYPE_LABEL[item.type]}{itemHeight ? ` · ${units.height(itemHeight.value)} ${itemHeight.kind === 'gain' ? 'to climb' : 'above sea level'}` : ''}</span></a>;
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
            <div className="venue-plan-mobile"><PlannerCard venue={venue} /></div>
          </div>

          <aside className="venue-detail-side">
            <div className="venue-actions-card">
              <p className="venue-actions-height">{height ? <><strong>{units.height(height.value)}</strong> {height.kind === 'gain' ? 'to climb' : 'above sea level'}</> : 'Height not recorded'}</p>
              <p className="venue-actions-source">{sourceLine}</p>
              <button type="button" className="venue-primary-action" onClick={() => onShowOnMap()}>Show on map</button>
              {routes.length > 0 && <button type="button" className="venue-download-action" onClick={() => downloadRoute(routes[0])}>Download GPX{routes.length > 1 ? ` (${routes.length})` : ''}</button>}
              <div className="venue-card-actions"><button type="button" onClick={onToggleFavorite}><HeartIcon size={16} filled={isFavorite} />{isFavorite ? 'Saved' : 'Save'}</button><button type="button" onClick={() => void share()}><ShareGlyph />Share</button></div>
            </div>
            <a className="venue-report" href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer"><FlagGlyph />Report a problem with this venue</a>
            <div className="venue-plan-desktop"><PlannerCard venue={venue} /></div>
          </aside>
        </div>
      </main>

      <div className="venue-mobile-bar">
        <p>{height ? <><strong>{units.height(height.value)}</strong> {height.kind === 'gain' ? 'to climb' : 'above sea level'}</> : 'Height not recorded'}</p>
        <button type="button" onClick={() => onShowOnMap()}>Show on map</button>
      </div>
    </div>,
    document.body,
  );
}

export const VenueDetail = VenueDetailInner;
