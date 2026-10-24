import { useEffect, useState } from 'react';
import type { Route, Venue } from '../types';
import type { ElevationModel } from '../lib/elevation';
import { GpxParseError, toGpx } from '../lib/gpx';
import { parseTcx } from '../lib/tcx';
import { buildLoadedRoute, type LoadedRoute } from '../lib/loadRoute';
import { errorText } from '../lib/api';
import {
  connectGoogleHealth,
  disconnectGoogleHealth,
  fetchWorkoutTcx,
  googleHealthStatus,
  listGoogleWorkouts,
  workoutActivity,
  type GoogleWorkout,
} from '../lib/googleHealth';
import { track } from '../lib/analytics';
import { ActivityIcon } from './ActivityIcon';
import { useUnits } from './UnitsContext';

interface GoogleHealthImportProps {
  elevationModel: ElevationModel | null;
  venues: Venue[];
  existingRoutes: Route[];
  onLoaded: (loaded: LoadedRoute) => void;
  onShowExisting: (slug: string) => void;
}

type Stage = 'checking' | 'disconnected' | 'loading' | 'ready' | 'error';

function workoutDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The "or pull it from Google" half of the import dialog. Linking is a
 * consent popup from the same OAuth client as sign-in — no redirect, no
 * server. Once linked, workouts list here and each import downloads its TCX
 * track, converts it to GPX and runs the same pipeline as a dropped file —
 * nothing is stored until the user publishes.
 */
export function GoogleHealthImport({ elevationModel, venues, existingRoutes, onLoaded, onShowExisting }: GoogleHealthImportProps) {
  const units = useUnits();
  const [stage, setStage] = useState<Stage>('checking');
  const [workouts, setWorkouts] = useState<GoogleWorkout[]>([]);
  const [alert, setAlert] = useState<{ message: string } | { duplicate: Route } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState('');

  const loadWorkouts = async () => {
    setStage('loading');
    try {
      const listed = await listGoogleWorkouts();
      setWorkouts(listed.slice().sort((a, b) => b.startTime.localeCompare(a.startTime)));
      setStage('ready');
    } catch (caught) {
      setAlert({ message: errorText(caught) });
      setStage(caught instanceof Error && 'code' in caught && caught.code === 'access_denied' ? 'disconnected' : 'error');
    }
  };

  useEffect(() => {
    let live = true;
    googleHealthStatus()
      .then((status) => {
        if (!live) return;
        if (status.connected) void loadWorkouts();
        else setStage('disconnected');
      })
      .catch(() => live && setStage('disconnected'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setStage('checking');
    setAlert(null);
    try {
      await connectGoogleHealth(); // consent popup
      await loadWorkouts();
    } catch (caught) {
      setAlert({ message: errorText(caught) });
      setStage('disconnected');
    }
  };

  const importWorkout = async (workout: GoogleWorkout) => {
    setBusyId(workout.id);
    setAlert(null);
    setStatusLine('Downloading the GPS track…');
    try {
      const tcx = await fetchWorkoutTcx(workout.id);
      const parsed = parseTcx(tcx);
      // The stored original is the converted GPX — timestamps included so
      // speed classification and the recorded date keep working.
      const gpx = toGpx(workout.name, parsed.points, [], true, parsed.times);
      setStatusLine('');
      const result = await buildLoadedRoute(parsed, gpx, workout.name, {
        elevationModel,
        venues,
        existingRoutes,
        onStatus: setStatusLine,
      });
      if (result.kind === 'duplicate') {
        setAlert({ duplicate: result.route });
        return;
      }
      track('ghealth_import', workout.name);
      onLoaded(result.loaded);
    } catch (caught) {
      // Parse failures ("no GPS track points") are phrased for people too.
      setAlert({ message: caught instanceof GpxParseError ? caught.message : errorText(caught) });
    } finally {
      setBusyId(null);
      setStatusLine('');
    }
  };

  return (
    <div className="ghealth">
      <div className="ghealth-divider" aria-hidden="true">
        <span>or pull it from Google Health</span>
      </div>

      {stage === 'checking' || stage === 'loading' ? (
        <p className="ghealth-row muted">{stage === 'checking' ? 'Checking the connection…' : 'Fetching your workouts…'}</p>
      ) : stage === 'disconnected' ? (
        <div className="ghealth-row">
          <p>
            Link Google Health to pull GPS workouts from Fitbit, Pixel Watch and synced watches.
            <span className="ghealth-disclosure">
              hillGPX reads your workout list and GPS tracks to turn them into routes — nothing is stored until you
              choose to publish.
            </span>
          </p>
          <button type="button" className="btn btn-light btn-sm" onClick={() => void connect()}>
            Connect Google Health
          </button>
        </div>
      ) : stage === 'error' ? (
        <div className="ghealth-row">
          <p className="ghealth-note error">{alert && 'message' in alert ? alert.message : 'Google Health did not answer.'}</p>
          <button type="button" className="btn btn-light btn-sm" onClick={() => void loadWorkouts()}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {workouts.length === 0 ? (
            <p className="ghealth-row muted">No workouts found — outdoor runs, rides and hikes with GPS show up here.</p>
          ) : (
            <ul className="ghealth-list">
              {workouts.map((workout) => (
                <li key={workout.id} className="ghealth-workout">
                  <ActivityIcon activity={workoutActivity(workout.type)} size={15} />
                  <span className="ghealth-workout-main">
                    <strong>{workout.name}</strong>
                    <span className="muted">
                      {workoutDate(workout.startTime)}
                      {workout.distanceM ? ` · ${units.distance(workout.distanceM)}` : ''}
                      {workout.hasGps ? '' : ' · no GPS track'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-light btn-sm"
                    disabled={!workout.hasGps || busyId !== null}
                    onClick={() => void importWorkout(workout)}
                  >
                    {busyId === workout.id ? 'Importing…' : 'Import'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {statusLine && <p className="ghealth-row muted" role="status">{statusLine}</p>}
          {alert && 'duplicate' in alert && (
            <div className="gpx-import-duplicate" role="alert">
              <p>
                <strong>This route is already here</strong> as “{alert.duplicate.name}”. Each track is stored once so the
                map stays clean.
              </p>
              <button type="button" className="btn btn-light" onClick={() => onShowExisting(alert.duplicate.slug)}>
                Show it on the map
              </button>
            </div>
          )}
          <button
            type="button"
            className="ghealth-unlink"
            onClick={() => {
              void disconnectGoogleHealth().then(() => {
                setWorkouts([]);
                setStage('disconnected');
              });
            }}
          >
            Unlink Google Health
          </button>
        </>
      )}

      {alert && 'message' in alert && stage !== 'error' && (
        <p className="gpx-import-error" role="alert">{alert.message}</p>
      )}
    </div>
  );
}
