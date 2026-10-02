import { useMemo, useState } from 'react';
import type { Route, RouteActivity, Venue } from '../types';
import { computeGain } from '../lib/elevation';
import { routeFromPoints } from '../lib/routes';
import { HEIGHT_LABEL, venueHeight } from '../lib/venues';
import { ACTIVITY_LABEL, findOverlaps } from '../lib/routeAnalysis';
import { DuplicateRouteError, loadAuthor, publishRoute, saveAuthor, uploadRouteThumb } from '../lib/api';
import type { LoadedGpx } from './GpxDropzone';
import { ElevationProfile } from './ElevationProfile';
import { TypeGlyph } from './TypeGlyph';
import { useUnits } from './UnitsContext';
import { downloadRoute } from './VenueCard';
import { CheckIcon, CloseIcon, DownloadIcon } from './icons';
import { InfoTip, RecordedLine, ElevationSourceLine, OverlapChips } from './RoutePanel';

interface GpxPanelProps {
  loaded: LoadedGpx;
  venuesBySlug: Map<string, Venue>;
  allRoutes: Route[];
  hoverIndex: number | null;
  onHoverIndex: (index: number | null) => void;
  onClose: () => void;
  onPublished: (route: Route) => void;
  published: Route | null;
  spotlightSlug: string | null;
  onShowVenue: (slug: string) => void;
  onShowRoute: (slug: string) => void;
}

const ACTIVITIES: RouteActivity[] = ['run', 'trail', 'cycle'];

export function GpxPanel({
  loaded,
  venuesBySlug,
  allRoutes,
  hoverIndex,
  onHoverIndex,
  onClose,
  onPublished,
  published,
  spotlightSlug,
  onShowVenue,
  onShowRoute,
}: GpxPanelProps) {
  const units = useUnits();
  const [name, setName] = useState(loaded.name);
  const [activity, setActivity] = useState<RouteActivity>(loaded.activity);
  const [author, setAuthor] = useState(loadAuthor);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const route = useMemo(
    () => routeFromPoints(name.trim() || loaded.name, loaded.points, loaded.venueSlugs),
    [loaded, name],
  );
  const { minM, maxM } = useMemo(() => computeGain(loaded.points), [loaded.points]);
  const overlaps = useMemo(() => findOverlaps(loaded.points, allRoutes), [loaded.points, allRoutes]);
  const linkedVenues = loaded.venueSlugs
    .map((slug) => venuesBySlug.get(slug))
    .filter((venue): venue is Venue => Boolean(venue));

  const publish = async () => {
    setBusy(true);
    setError(null);
    saveAuthor(author);
    try {
      const stored = await publishRoute({
        route,
        activity,
        fingerprint: loaded.fingerprint,
        recordedAt: loaded.recordedAt,
        elevationSource: loaded.elevationSource,
        originalGpx: loaded.originalGpx,
        contributor: author,
        licence: 'CC BY 4.0',
      });
      onPublished(stored);
      // The card image is a nicety: render it after publishing, never block on it.
      void import('../map/renderThumb')
        .then(({ renderRouteThumb }) => renderRouteThumb(stored))
        .then((thumb) => (thumb ? uploadRouteThumb(stored.slug, thumb.key, thumb.blob) : undefined))
        .catch(() => undefined);
    } catch (caught) {
      setError(
        caught instanceof DuplicateRouteError
          ? caught.message
          : `Could not publish right now (${(caught as Error).message}). Your route is still open here; try again in a moment.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="gpx-panel" aria-label={`Imported route: ${loaded.name}`}>
      <header className="gpx-panel-head">
        <div className="route-panel-title">
          <h2>{published?.name ?? (name.trim() || loaded.name)}</h2>
          <InfoTip>
            <RecordedLine recordedAt={loaded.recordedAt} />
            <ElevationSourceLine source={loaded.elevationSource} />
          </InfoTip>
        </div>
        <div className="gpx-panel-actions">
          <button type="button" className="gpx-icon-btn" onClick={() => downloadRoute(published ?? route)} aria-label="Download GPX" data-tip="Download GPX">
            <DownloadIcon size={15} />
          </button>
          <button type="button" className="gpx-close" onClick={onClose} aria-label="Close GPX panel">
            <CloseIcon size={12} />
          </button>
        </div>
      </header>

      <div className="gpx-stats">
        {[
          ['Distance', units.distance(loaded.distanceM)],
          ['EG', units.height(loaded.gainM)],
          ['EL', units.height(loaded.lossM)],
          ['Highest', units.height(maxM)],
          ['Lowest', units.height(minM)],
        ].map(([label, value]) => (
          <div className="gpx-stat" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <div className="gpx-touches">
        <strong>Passes</strong>
        {linkedVenues.length > 0 ? (
          linkedVenues.map((venue) => {
            const height = venueHeight(venue);
            return (
              <button
                type="button"
                key={venue.slug}
                className={venue.slug === spotlightSlug ? 'on' : undefined}
                aria-pressed={venue.slug === spotlightSlug}
                onClick={() => onShowVenue(venue.slug)}
              >
                <TypeGlyph type={venue.type} />
                {venue.name}
                {height && ` · ${units.height(height.value)} ${HEIGHT_LABEL[height.kind]}`}
              </button>
            );
          })
        ) : (
          <span>No mapped place within 150 m</span>
        )}
      </div>

      <OverlapChips overlaps={overlaps} onShowRoute={onShowRoute} />

      <ElevationProfile points={loaded.points} height={96} hoverIndex={hoverIndex} onHoverIndex={onHoverIndex} />

      {published ? (
        <p className="gpx-published" role="status">
          <CheckIcon size={14} /> Published to the community archive. Thank you — anyone can now find and download it.
        </p>
      ) : (
        <form
          className="gpx-publish"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void publish();
          }}
        >
          <h3>Share it with everyone</h3>
          <label className="field">
            <span>Route name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
          </label>
          <div className="field">
            <span>Type</span>
            <div className="chip-row" role="radiogroup" aria-label="Route type">
              {ACTIVITIES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={activity === value}
                  className={`chip${activity === value ? ' on' : ''}`}
                  onClick={() => setActivity(value)}
                >
                  {ACTIVITY_LABEL[value]}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Credit as (optional)</span>
            <input value={author} onChange={(event) => setAuthor(event.target.value)} maxLength={60} placeholder="Your name or handle" />
          </label>
          <p className="photo-note publish-note">
            Free for everyone under CC BY 4.0, credited to you.
            <InfoTip label="What is stored">
              <span className="route-meta">The track, its elevation and the recording date are kept.</span>
              <span className="route-meta muted">Heart rate, cadence, power and other device data are removed from the file before it is stored.</span>
            </InfoTip>
          </p>
          {error && <p className="gpx-import-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-accent" disabled={busy}>
            {busy ? 'Publishing…' : 'Publish route'}
          </button>
        </form>
      )}
    </section>
  );
}
