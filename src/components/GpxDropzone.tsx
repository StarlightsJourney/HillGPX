import { useCallback, useRef, useState } from 'react';
import type { RoutePoint, Venue } from '../types';
import { GpxParseError, parseGpx, simplify } from '../lib/gpx';
import { ElevationModel, computeGain, totalDistanceM } from '../lib/elevation';
import { linkVenues } from '../lib/routes';

interface GpxDropzoneProps {
  elevationModel: ElevationModel | null;
  venues: Venue[];
  onLoaded: (loaded: LoadedGpx) => void;
}

export interface LoadedGpx {
  name: string;
  points: RoutePoint[];
  distanceM: number;
  gainM: number;
  lossM: number;
  resampled: boolean;
  venueSlugs: string[];
}

/**
 * Drop a GPX in, get a real elevation profile out.
 *
 * The file is read and parsed in this tab. Nothing is uploaded — there is no
 * server to upload it to — so someone can analyse a route without handing over
 * their GPS history. Worth keeping true as the project grows.
 */
export function GpxDropzone({ elevationModel, venues, onLoaded }: GpxDropzoneProps) {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const parsed = parseGpx(await file.text());
        // Watch exports routinely run to tens of thousands of points; thin them
        // before anything else touches the data.
        let points = simplify(parsed.points);
        const covered = elevationModel
          ? points.filter(([lng, lat]) => elevationModel.covers(lng, lat)).length
          : 0;
        const resampled = points.length > 0 && covered / points.length >= 0.5;
        if (elevationModel) points = elevationModel.resampleElevation(points);
        const { gainM, lossM } = computeGain(points);
        onLoaded({
          name: parsed.name ?? file.name.replace(/\.gpx$/i, ''),
          points,
          distanceM: totalDistanceM(points),
          gainM,
          lossM,
          resampled,
          venueSlugs: linkVenues(points, venues),
        });
      } catch (caught) {
        setError(
          caught instanceof GpxParseError
            ? caught.message
            : `Could not read that file: ${(caught as Error).message}`,
        );
      }
    },
    [elevationModel, onLoaded, venues],
  );

  return (
    <section
      className={`dropzone${dragging ? ' dragging' : ''}`}
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
    >
      <strong>Drop a GPX here</strong>
      <button type="button" className="dropzone-browse" onClick={() => inputRef.current?.click()}>
        Browse files
      </button>
      <p>Parsed in your browser. The file is never uploaded.</p>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".gpx,application/gpx+xml"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {error && <p className="dropzone-error">{error}</p>}
    </section>
  );
}
