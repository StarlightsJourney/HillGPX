import { useEffect, useMemo, useRef, useState } from 'react';
import type { Route, RoutePoint, Venue } from '../types';
import { computeGain, totalDistanceM } from '../lib/elevation';
import { routeHasElevation } from '../lib/routes';
import { regionOf } from '../lib/regions';
import { terrainElevations } from '../lib/terrain';
import { ACTIVITY_LABEL, findOverlaps, routeActivity, type RouteOverlap } from '../lib/routeAnalysis';
import { ElevationProfile } from './ElevationProfile';
import { TypeGlyph } from './TypeGlyph';
import { useUnits } from './UnitsContext';
import { downloadRoute } from './VenueCard';
import { ChevronRightIcon, CloseIcon, DownloadIcon } from './icons';
import type { RoutePhoto } from '../lib/api';
import { RoutePhotoModal } from './RoutePhotoModal';
import { FlagIcon, ReportModal } from './ReportModal';

interface RoutePanelProps {
  route: Route;
  venuesBySlug: Map<string, Venue>;
  allRoutes: Route[];
  hoverIndex: number | null;
  onHoverIndex: (index: number | null) => void;
  onClose: () => void;
  spotlightSlug: string | null;
  onShowVenue: (slug: string) => void;
  onShowRoute: (slug: string) => void;
  routePhotos: RoutePhoto[];
  onFocusPhoto: (photo: RoutePhoto) => void;
  onPhotoAdded: (photo: RoutePhoto) => void;
}

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

/** "Recorded 12 Mar 2024 · 2 years ago", with a nudge when a track is old enough that trails may have changed. */
export function RecordedLine({ recordedAt }: { recordedAt: string | null | undefined }) {
  // Read once per mount: "2 years ago" does not need to tick while the panel is open.
  const [now] = useState(() => Date.now());
  if (!recordedAt) return <p className="route-meta muted">Recording date not in file</p>;
  const date = new Date(recordedAt);
  const years = (now - date.getTime()) / YEAR_MS;
  const ago = years < 1 / 12 ? 'this month' : years < 1 ? `${Math.round(years * 12)} months ago` : `${Math.floor(years)} year${Math.floor(years) === 1 ? '' : 's'} ago`;
  return (
    <p className={`route-meta${years >= 3 ? ' stale' : ''}`}>
      Recorded {date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · {ago}
      {years >= 3 && ' · trails may have changed since'}
    </p>
  );
}

/** Secondary facts (when it was recorded, where EG/EL came from) behind an (i), not in the way. */
export function InfoTip({ children, label = 'About these numbers' }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  // Hover shows it on a mouse; a tap toggles it on touch screens.
  const hoverable = () => window.matchMedia('(hover: hover)').matches;
  return (
    <span
      className="info-tip"
      ref={ref}
      onMouseEnter={() => hoverable() && setOpen(true)}
      onMouseLeave={() => hoverable() && setOpen(false)}
    >
      <button type="button" className="info-tip-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => hoverable() || !v)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5.5" />
          <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
        </svg>
      </button>
      {open && <span className="info-tip-pop" role="tooltip">{children}</span>}
    </span>
  );
}

/** Who added a route and under what licence, shown inside the (i) rather than under the panel. */
function RouteCredit({ route }: { route: Route }) {
  if (!route.contributor && !route.licence && !route.sourceUrl) return null;
  return (
    <span className="route-meta muted">
      {route.contributor && <>Added by {route.contributor}. </>}
      {route.licence && <>{route.licence}. </>}
      {route.sourceUrl && (
        <a href={route.sourceUrl} target="_blank" rel="noreferrer">
          Source
        </a>
      )}
    </span>
  );
}

export function ElevationSourceLine({ source }: { source: Route['elevationSource'] | 'dem' }) {
  const text = source === 'terrain'
    ? 'EG/EL measured from terrain data (the file had no elevation)'
    : source === 'dem'
      ? 'EG/EL from Singapore terrain model'
      : 'EG/EL from the device that recorded it';
  return <p className="route-meta muted">{text}</p>;
}

export function OverlapChips({ overlaps, onShowRoute }: { overlaps: RouteOverlap[]; onShowRoute: (slug: string) => void }) {
  if (overlaps.length === 0) return null;
  return (
    <div className="gpx-touches route-overlaps">
      <strong>Shares ground with</strong>
      {overlaps.slice(0, 4).map(({ route, share }) => (
        <button type="button" key={route.slug} onClick={() => onShowRoute(route.slug)} title={`${Math.round(share * 100)}% of this route runs along ${route.name}`}>
          {route.name} · {Math.round(share * 100)}%
        </button>
      ))}
    </div>
  );
}

/** Ground elevation for routes whose file had none, measured once per route on demand. */
function useTerrainFill(route: Route): { points: RoutePoint[]; gainM: number; lossM: number; fromTerrain: boolean; pending: boolean } {
  const needsFill = !routeHasElevation(route);
  const [filled, setFilled] = useState<{ slug: string; points: RoutePoint[] | null } | null>(null);
  useEffect(() => {
    if (!needsFill) return;
    let cancelled = false;
    void terrainElevations(route.coordinates).then((points) => {
      if (!cancelled) setFilled({ slug: route.slug, points });
    });
    return () => {
      cancelled = true;
    };
  }, [needsFill, route.coordinates, route.slug]);
  const ready = filled?.slug === route.slug ? filled.points : null;
  return useMemo(() => {
    if (!needsFill) return { points: route.coordinates, gainM: route.gainM, lossM: route.lossM, fromTerrain: false, pending: false };
    if (!ready) return { points: route.coordinates, gainM: 0, lossM: 0, fromTerrain: false, pending: filled?.slug !== route.slug };
    const { gainM, lossM } = computeGain(ready);
    return { points: ready, gainM, lossM, fromTerrain: true, pending: false };
  }, [needsFill, ready, route, filled]);
}

/**
 * The selected route, over the map with its profile: a side sheet down the
 * left of a wide map, a sheet along the bottom of a narrow one.
 *
 * Compact by default — title, the three numbers people compare routes by, and
 * a short profile — so the route itself keeps most of the map. "More details"
 * grows it into the full sheet (every stat, places passed, overlaps, photos).
 */
export function RoutePanel({ route, venuesBySlug, allRoutes, hoverIndex, onHoverIndex, onClose, spotlightSlug, onShowVenue, onShowRoute, routePhotos, onFocusPhoto, onPhotoAdded }: RoutePanelProps) {
  const [adding, setAdding] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const units = useUnits();
  const elevation = useTerrainFill(route);
  const hasElevation = routeHasElevation(route) || elevation.fromTerrain;
  const { minM, maxM } = useMemo(() => computeGain(elevation.points), [elevation.points]);
  const overlaps = useMemo(() => findOverlaps(route.coordinates, allRoutes, route.slug), [route, allRoutes]);
  const region = route.country ?? regionOf(route.coordinates[0][0], route.coordinates[0][1]);
  const touches = route.venueSlugs
    .map((slug) => venuesBySlug.get(slug))
    .filter((venue): venue is Venue => Boolean(venue));
  const km = totalDistanceM(route.coordinates) / 1000 || 1;
  const unavailable = elevation.pending ? 'Measuring…' : 'Unavailable';

  return (
    <section className={`gpx-panel route-panel ${expanded ? 'expanded' : 'compact'}`} aria-label={`Route: ${route.name}`} key={route.slug}>
      <header className="gpx-panel-head">
        <div className="route-panel-title">
          <h2>{route.name}</h2>
          <InfoTip>
            <RecordedLine recordedAt={route.recordedAt} />
            {hasElevation && <ElevationSourceLine source={elevation.fromTerrain ? 'terrain' : route.elevationSource ?? 'gps'} />}
            <span className="route-meta muted">{[ACTIVITY_LABEL[routeActivity(route)], region, route.loop ? 'Loop' : 'Point to point'].filter(Boolean).join(' · ')}</span>
            <RouteCredit route={route} />
            <button type="button" className="info-tip-action" onClick={() => setReporting(true)}>
              <FlagIcon />
              Report an issue with this route
            </button>
          </InfoTip>
        </div>
        <div className="gpx-panel-actions">
          <button type="button" className="gpx-icon-btn" onClick={() => downloadRoute(route)} aria-label="Download GPX" data-tip="Download GPX">
            <DownloadIcon size={15} />
          </button>
          <button
            type="button"
            className="gpx-icon-btn gpx-collapse"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={expanded ? 'Show fewer route details' : 'Show more route details'}
            data-tip={expanded ? 'Fewer details' : 'More details'}
          >
            <ChevronRightIcon size={15} />
          </button>
          <button type="button" className="gpx-close" onClick={onClose} aria-label="Close route">
            <CloseIcon size={12} />
          </button>
        </div>
      </header>

      <div className="gpx-stats">
        {[
          ['Distance', units.distance(route.distanceM)],
          ['EG', hasElevation ? units.height(elevation.gainM) : unavailable],
          ['EL', hasElevation ? units.height(elevation.lossM) : unavailable],
          ['Highest', hasElevation ? units.height(maxM) : unavailable],
          ['Lowest', hasElevation ? units.height(minM) : unavailable],
          ['EG / km', hasElevation ? units.height(elevation.gainM / km) : unavailable],
        ].slice(0, expanded ? undefined : 3).map(([label, value]) => (
          <div className="gpx-stat" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      {expanded && touches.length > 0 && (
        <div className="gpx-touches">
          <strong>Passes</strong>
          {touches.map((venue) => (
            <button
              type="button"
              key={venue.slug}
              className={venue.slug === spotlightSlug ? 'on' : undefined}
              aria-pressed={venue.slug === spotlightSlug}
              onClick={() => onShowVenue(venue.slug)}
            >
              <TypeGlyph type={venue.type} />
              {venue.name}
            </button>
          ))}
        </div>
      )}

      {expanded && <OverlapChips overlaps={overlaps} onShowRoute={onShowRoute} />}

      {expanded && (
        <div className="route-photos">
          <strong>Along the route</strong>
          {routePhotos.map((photo) => (
            <button type="button" key={photo.id} className={`route-photo-thumb ${photo.kind}`} onClick={() => onFocusPhoto(photo)} title={photo.caption || (photo.kind === 'hazard' ? 'Hazard' : 'Photo')}>
              <img src={photo.url} alt="" loading="lazy" />
              {photo.kind === 'hazard' && <span aria-label="Hazard">!</span>}
              {photo.pending && <em className="route-photo-pending">Pending</em>}
            </button>
          ))}
          <button type="button" className="route-photo-add" onClick={() => setAdding(true)}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
            Photo or hazard
          </button>
        </div>
      )}

      {hasElevation ? (
        <ElevationProfile points={elevation.points} height={expanded ? 120 : 64} hoverIndex={hoverIndex} onHoverIndex={onHoverIndex} />
      ) : (
        <p className="route-elevation-unavailable">{elevation.pending ? 'Measuring elevation from terrain data…' : 'Elevation is unavailable for this route.'}</p>
      )}

      {adding && <RoutePhotoModal route={route} startIndex={hoverIndex ?? Math.floor(route.coordinates.length / 2)} onPreviewIndex={onHoverIndex} onClose={() => setAdding(false)} onAdded={onPhotoAdded} />}
      {reporting && <ReportModal targetType="route" targetSlug={route.slug} targetName={route.name} onClose={() => setReporting(false)} />}
    </section>
  );
}
