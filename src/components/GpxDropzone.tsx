import { useCallback, useRef, useState } from 'react';
import type { Route, RouteActivity, RoutePoint, Venue } from '../types';
import { GpxParseError, parseGpx, simplify } from '../lib/gpx';
import { ElevationModel, computeGain, totalDistanceM } from '../lib/elevation';
import { linkVenues } from '../lib/routes';
import { hasRealElevation, terrainElevations } from '../lib/terrain';
import { classifyActivity, isSameRoute, routeFingerprint } from '../lib/routeAnalysis';
import { UploadIcon } from './icons';

interface GpxDropzoneProps {
  elevationModel: ElevationModel | null;
  venues: Venue[];
  /** Everything already on the map, to stop the same track being added twice. */
  existingRoutes: Route[];
  onLoaded: (loaded: LoadedGpx) => void;
  onShowExisting: (slug: string) => void;
}

export interface LoadedGpx {
  name: string;
  points: RoutePoint[];
  distanceM: number;
  gainM: number;
  lossM: number;
  /** Where EG/EL came from: the device, Singapore's terrain model, or worldwide terrain tiles. */
  elevationSource: 'gps' | 'dem' | 'terrain';
  /** Kept for the old panel badge: true when heights were replaced by terrain. */
  resampled: boolean;
  venueSlugs: string[];
  recordedAt: string | null;
  activity: RouteActivity;
  fingerprint: string;
  /** The file exactly as uploaded, stored alongside the simplified track. */
  originalGpx: string;
}

/** 200 km ultras and multi-day treks export at 50 MB+; the original is gzipped before upload. */
const MAX_FILE_BYTES = 60_000_000;
/** Enough detail for the map and profile, small enough to store and draw quickly. */
const POINT_BUDGET = 4000;

/** Douglas–Peucker with a tolerance that grows until the track fits the point budget. */
function simplifyToBudget(points: RoutePoint[]): RoutePoint[] {
  let tolerance = 1e-5;
  let out = simplify(points, tolerance);
  while (out.length > POINT_BUDGET && tolerance < 1e-3) {
    tolerance *= 1.6;
    out = simplify(points, tolerance);
  }
  return out;
}

type Stage = { kind: 'idle' } | { kind: 'working'; message: string } | { kind: 'error'; message: string } | { kind: 'duplicate'; route: Route };

/**
 * Add a GPX: drop or pick a file, and the route opens on the map with its
 * profile. Elevation comes from the file when it has any; otherwise from
 * terrain data, so planned routes and OSM traces still get honest EG and EL.
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
        const parsed = parseGpx(originalGpx);
        let points = simplifyToBudget(parsed.points);
        const fingerprint = routeFingerprint(points);
        const duplicate = existingRoutes.find((route) => isSameRoute(points, route));
        if (duplicate) {
          setStage({ kind: 'duplicate', route: duplicate });
          return;
        }

        // The file's own elevation wins: it is what the runner's device measured.
        // Only a file with none falls back to Singapore's terrain model, then
        // to worldwide terrain tiles.
        let elevationSource: LoadedGpx['elevationSource'] = 'gps';
        if (!hasRealElevation(points)) {
          const coveredBySg = elevationModel
            ? points.filter(([lng, lat]) => elevationModel.covers(lng, lat)).length / points.length >= 0.5
            : false;
          if (elevationModel && coveredBySg) {
            points = elevationModel.resampleElevation(points);
            elevationSource = 'dem';
          } else {
            setStage({ kind: 'working', message: 'No elevation in this file — measuring it from terrain data…' });
            const filled = await terrainElevations(points);
            if (filled) {
              points = filled;
              elevationSource = 'terrain';
            }
          }
        }

        const { gainM, lossM } = computeGain(points);
        onLoaded({
          name: parsed.name?.trim() || file.name.replace(/\.gpx$/i, ''),
          points,
          distanceM: totalDistanceM(points),
          gainM,
          lossM,
          elevationSource,
          resampled: elevationSource !== 'gps',
          venueSlugs: linkVenues(points, venues),
          recordedAt: parsed.startedAt,
          // Speed needs the raw points (aligned with their timestamps); climbing needs the final elevation.
          activity: classifyActivity(parsed.points, gainM, parsed.times),
          fingerprint,
          originalGpx,
        });
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

      <ul className="gpx-import-notes">
        <li>Works with exports from Strava, Garmin, Coros, Suunto, Komoot and most watches.</li>
        <li>You review the route on the map before anything is published.</li>
        <li>Published routes are free for everyone under CC BY 4.0, credited to you.</li>
      </ul>
    </div>
  );
}
