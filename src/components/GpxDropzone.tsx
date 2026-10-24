import { useCallback, useRef, useState } from 'react';
import type { Route, Venue } from '../types';
import { GpxParseError, parseGpx } from '../lib/gpx';
import type { ElevationModel } from '../lib/elevation';
import { buildLoadedRoute, type LoadedRoute } from '../lib/loadRoute';
import { GoogleHealthImport } from './GoogleHealthImport';
import { UploadIcon } from './icons';

interface GpxDropzoneProps {
  elevationModel: ElevationModel | null;
  venues: Venue[];
  /** Everything already on the map, to stop the same track being added twice. */
  existingRoutes: Route[];
  onLoaded: (loaded: LoadedRoute) => void;
  onShowExisting: (slug: string) => void;
}

export type { LoadedRoute };
/** The pre-rename name; the panel and App still import it from here. */
export type LoadedGpx = LoadedRoute;

/** 200 km ultras and multi-day treks export at 50 MB+; the original is gzipped before upload. */
const MAX_FILE_BYTES = 60_000_000;

type Stage = { kind: 'idle' } | { kind: 'working'; message: string } | { kind: 'error'; message: string } | { kind: 'duplicate'; route: Route };

/**
 * Add a route: drop or pick a GPX file — or pull a Google Health workout —
 * and it opens on the map with its profile. Elevation comes from the track
 * when it has any; otherwise from terrain data, so planned routes and OSM
 * traces still get honest EG and EL.
 */
export function GpxDropzone({ elevationModel, venues, existingRoutes, onLoaded, onShowExisting }: GpxDropzoneProps) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        setStage({ kind: 'error', message: `That file is ${Math.round(file.size / 1e6)} MB; the limit is ${MAX_FILE_BYTES / 1e6} MB. Export it without heart-rate and power data and try again.` });
        return;
      }
      setStage({ kind: 'working', message: file.size > 5e6 ? `Reading a ${Math.round(file.size / 1e6)} MB GPX — long routes take a few seconds…` : 'Reading your GPX…' });
      try {
        const originalGpx = await file.text();
        const result = await buildLoadedRoute(parseGpx(originalGpx), originalGpx, file.name.replace(/\.gpx$/i, ''), {
          elevationModel,
          venues,
          existingRoutes,
          onStatus: (message) => setStage({ kind: 'working', message }),
        });
        if (result.kind === 'duplicate') {
          setStage({ kind: 'duplicate', route: result.route });
          return;
        }
        onLoaded(result.loaded);
        setStage({ kind: 'idle' });
      } catch (caught) {
        setStage({
          kind: 'error',
          message: caught instanceof GpxParseError ? caught.message : `Could not read that file: ${(caught as Error).message}`,
        });
      }
    },
    [elevationModel, existingRoutes, onLoaded, venues],
  );

  const pick = () => inputRef.current?.click();

  return (
    <div className="gpx-import">
      <section
        className={`gpx-drop${dragging ? ' dragging' : ''}${stage.kind === 'working' ? ' working' : ''}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        onClick={stage.kind === 'working' ? undefined : pick}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && pick()}
        aria-label="Choose a GPX file"
      >
        <span className="gpx-drop-icon" aria-hidden="true">
          <UploadIcon size={26} />
        </span>
        {stage.kind === 'working' ? (
          <strong>{stage.message}</strong>
        ) : (
          <>
            <strong>Drop a GPX file here</strong>
            <span className="gpx-drop-sub">or <u>browse your files</u></span>
          </>
        )}
        <input
          ref={inputRef}
          className="visually-hidden"
          type="file"
          accept=".gpx,application/gpx+xml"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void handleFile(file);
          }}
        />
      </section>

      {stage.kind === 'error' && <p className="gpx-import-error" role="alert">{stage.message}</p>}
      {stage.kind === 'duplicate' && (
        <div className="gpx-import-duplicate" role="alert">
          <p>
            <strong>This route is already here</strong> as “{stage.route.name}”. Each track is stored once so the map stays
            clean.
          </p>
          <button type="button" className="btn btn-light" onClick={() => onShowExisting(stage.route.slug)}>
            Show it on the map
          </button>
        </div>
      )}

      <GoogleHealthImport
        elevationModel={elevationModel}
        venues={venues}
        existingRoutes={existingRoutes}
        onLoaded={onLoaded}
        onShowExisting={onShowExisting}
      />

      <ul className="gpx-import-notes">
        <li>Works with exports from Strava, Garmin, Coros, Suunto, Komoot and most watches.</li>
        <li>You review the route on the map before anything is published.</li>
        <li>Published routes are free for everyone under CC BY 4.0, credited to you.</li>
      </ul>
    </div>
  );
}
