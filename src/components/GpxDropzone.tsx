import { useCallback, useRef, useState } from 'react';
import type { RoutePoint } from '../types';
import { GpxParseError, parseGpx, simplify } from '../lib/gpx';
import { ElevationModel, computeGain, totalDistanceM } from '../lib/elevation';
import { ElevationProfile } from './ElevationProfile';
import { formatDistance } from '../lib/venues';

interface GpxDropzoneProps {
  elevationModel: ElevationModel | null;
  onRouteLoaded: (points: RoutePoint[] | null) => void;
}

interface LoadedGpx {
  name: string;
  points: RoutePoint[];
  distanceM: number;
  gainM: number;
  lossM: number;
  /** True when we replaced the file's own altitudes with terrain-model values. */
  resampled: boolean;
}

/**
 * Drop a GPX in, get a real elevation profile out.
 *
 * The file is read with FileReader and parsed in this tab. Nothing is uploaded —
 * there is no server to upload it to — so someone can analyse a route without
 * handing over their GPS history. Worth keeping true as the project grows.
 */
export function GpxDropzone({ elevationModel, onRouteLoaded }: GpxDropzoneProps) {
  const [loaded, setLoaded] = useState<LoadedGpx | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const text = await file.text();
        const parsed = parseGpx(text);

        // Watch exports routinely run to tens of thousands of points; thin them
        // before anything else touches the data.
        let points = simplify(parsed.points);

        // Never trust GPX altitude when we have a terrain model to hand.
        const resampled = elevationModel != null;
        if (elevationModel) points = elevationModel.resampleElevation(points);

        const { gainM, lossM } = computeGain(points);

        const result: LoadedGpx = {
          name: parsed.name ?? file.name.replace(/\.gpx$/i, ''),
          points,
          distanceM: totalDistanceM(points),
          gainM,
          lossM,
          resampled,
        };
        setLoaded(result);
        onRouteLoaded(points);
      } catch (err) {
        const message =
          err instanceof GpxParseError
            ? err.message
            : `Could not read that file: ${(err as Error).message}`;
        setError(message);
        setLoaded(null);
        onRouteLoaded(null);
      }
    },
    [elevationModel, onRouteLoaded],
  );

  const clear = () => {
    setLoaded(null);
    setError(null);
    onRouteLoaded(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  if (loaded) {
    return (
      <section className="dropzone-result">
        <header className="panel-head">
          <h3>{loaded.name}</h3>
          <button className="icon-btn" onClick={clear} aria-label="Clear route">
            ×
          </button>
        </header>
        <div className="stats">
          <div className="stat">
            <span className="stat-value">{Math.round(loaded.gainM)} m</span>
            <span className="stat-label small muted">Gain</span>
          </div>
          <div className="stat">
            <span className="stat-value">{formatDistance(loaded.distanceM)}</span>
            <span className="stat-label small muted">Distance</span>
          </div>
          <div className="stat">
            <span className="stat-value">{Math.round(loaded.lossM)} m</span>
            <span className="stat-label small muted">Descent</span>
          </div>
        </div>
        <ElevationProfile points={loaded.points} />
        <p className="muted small">
          {loaded.resampled
            ? 'Elevation re-sampled from the bundled terrain model, not the file — GPS altitude is too noisy to sum directly.'
            : 'Terrain model unavailable, so these figures come from the file’s own GPS altitude and will read high.'}
        </p>
      </section>
    );
  }

  return (
    <section
      className={`dropzone${dragging ? ' dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void handleFile(file);
      }}
    >
      <p>
        <strong>Drop a GPX here</strong> to see its real elevation profile.
      </p>
      <p className="muted small">Parsed in your browser. The file is never uploaded.</p>
      <input
        ref={inputRef}
        type="file"
        accept=".gpx,application/gpx+xml"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {error && <p className="error small">{error}</p>}
    </section>
  );
}
