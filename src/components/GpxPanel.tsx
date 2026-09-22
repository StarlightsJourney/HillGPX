import { useMemo, useState } from 'react';
import type { Route, Venue } from '../types';
import { computeGain } from '../lib/elevation';
import { routeFromPoints } from '../lib/routes';
import { venueHeight } from '../lib/venues';
import type { LoadedGpx } from './GpxDropzone';
import { ElevationProfile } from './ElevationProfile';
import { TypeGlyph } from './TypeGlyph';
import { useUnits } from './UnitsContext';
import { downloadRoute } from './VenueCard';
import { CheckIcon, DownloadIcon } from './icons';

interface GpxPanelProps {
  loaded: LoadedGpx;
  venuesBySlug: Map<string, Venue>;
  hoverIndex: number | null;
  onHoverIndex: (index: number | null) => void;
  onClose: () => void;
  onSave: (route: Route) => void;
  saved: boolean;
}

export function GpxPanel({
  loaded,
  venuesBySlug,
  hoverIndex,
  onHoverIndex,
  onClose,
  onSave,
  saved,
}: GpxPanelProps) {
  const units = useUnits();
  const [saveError, setSaveError] = useState<string | null>(null);
  const route = useMemo(
    () => routeFromPoints(loaded.name, loaded.points, loaded.venueSlugs),
    [loaded],
  );
  const { minM, maxM } = useMemo(() => computeGain(loaded.points), [loaded.points]);
  const linkedVenues = loaded.venueSlugs
    .map((slug) => venuesBySlug.get(slug))
    .filter((venue): venue is Venue => Boolean(venue));

  const save = () => {
    try {
      onSave(route);
      setSaveError(null);
    } catch (error) {
      setSaveError((error as Error).message);
    }
  };

  return (
    <section className="gpx-panel" aria-label={`Imported route: ${loaded.name}`}>
      <header className="gpx-panel-head">
        <h2>{loaded.name}</h2>
        <div className="gpx-panel-actions">
          <button
            type="button"
            className="gpx-save"
            onClick={save}
            disabled={saved || loaded.venueSlugs.length === 0}
            title={loaded.venueSlugs.length === 0 ? 'Passes no mapped venue' : undefined}
          >
            {saved ? (
              <><CheckIcon size={14} />Saved</>
            ) : (
              <>
                Save<span className="hide-narrow"> to this device</span>
              </>
            )}
          </button>
          <button type="button" className="gpx-download" onClick={() => downloadRoute(route)}>
            <DownloadIcon size={14} />Download GPX
          </button>
          <button type="button" className="gpx-close" onClick={onClose} aria-label="Close GPX panel">
            ×
          </button>
        </div>
      </header>

      <div className="gpx-stats">
        {[
          ['Distance', units.distance(loaded.distanceM)],
          ['Gain', units.height(loaded.gainM)],
          ['Descent', units.height(loaded.lossM)],
          ['Max', units.height(maxM)],
          ['Min', units.height(minM)],
        ].map(([label, value]) => (
          <div className="gpx-stat" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
        {!loaded.resampled && <span className="gpx-altitude-tag">GPS altitude</span>}
      </div>

      <div className="gpx-touches">
        <strong>Touches:</strong>
        {linkedVenues.length > 0 ? (
          linkedVenues.map((venue) => {
            const height = venueHeight(venue);
            return (
              <a key={venue.slug} href={`#venue/${venue.slug}`}>
                <TypeGlyph type={venue.type} />
                {venue.name}
                {height && ` · ${units.height(height.value)}`}
              </a>
            );
          })
        ) : (
          <span>Passes no mapped venue within 150 m</span>
        )}
      </div>

      {saved && (
        <p className="gpx-saved-note">
          Attached to {loaded.venueSlugs.length} venue{loaded.venueSlugs.length === 1 ? '' : 's'} in this browser
        </p>
      )}
      {saveError && <p className="gpx-save-error">{saveError}</p>}

      <ElevationProfile
        points={loaded.points}
        height={96}
        hoverIndex={hoverIndex}
        onHoverIndex={onHoverIndex}
      />
    </section>
  );
}
