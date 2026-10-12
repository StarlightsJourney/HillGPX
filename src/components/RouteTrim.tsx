import { useMemo, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { RoutePoint } from '../types';
import { cumulativeDistances } from '../lib/elevation';
import { useUnits } from './UnitsContext';

interface RouteTrimProps {
  points: RoutePoint[];
  /** The kept range as inclusive point indices; null means the whole track. */
  trim: [number, number] | null;
  onChange: (trim: [number, number] | null) => void;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Cut the ends off a dropped GPX before publishing. Two handles on a distance
 * axis — the same control as the elevation range in Filters — so the cut can
 * be watched on the map and the profile as it is dragged, not committed blind.
 * Every move reports straight to the panel; nothing here waits for a commit.
 */
export function RouteTrim({ points, trim, onChange }: RouteTrimProps) {
  const units = useUnits();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'min' | 'max' | null>(null);
  // Handle positions follow distance, like the profile above them, not point
  // index — watches sample unevenly, so an index axis would bunch the busy
  // parts of the route up at one end.
  const distances = useMemo(() => cumulativeDistances(points), [points]);
  const total = distances[distances.length - 1] || 1;
  const lastIndex = points.length - 1;

  const startIndex = trim?.[0] ?? 0;
  const endIndex = trim?.[1] ?? lastIndex;

  /** The point nearest `target` metres along the track. Distances are monotonic. */
  const indexAtDistance = (target: number): number => {
    let best = 0;
    for (let i = 1; i < distances.length; i++) {
      if (Math.abs(distances[i] - target) < Math.abs(distances[best] - target)) best = i;
    }
    return best;
  };

  /** A kept range of at least two points, reported as null when nothing is cut. */
  const commit = (nextMin: number, nextMax: number) => {
    const lower = clamp(nextMin, 0, Math.max(0, nextMax - 1));
    const upper = clamp(nextMax, lower + 1, lastIndex);
    onChange(lower === 0 && upper === lastIndex ? null : [lower, upper]);
  };

  const indexFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return indexAtDistance(clamp((clientX - rect.left) / rect.width, 0, 1) * total);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const index = indexFromClientX(e.clientX);
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]');
    const grabbed = handle?.dataset.handle === 'max' ? 'max'
      : handle?.dataset.handle === 'min' ? 'min'
      : Math.abs(index - startIndex) <= Math.abs(index - endIndex) ? 'min' : 'max';
    dragging.current = grabbed;
    e.currentTarget.querySelector<HTMLElement>(`[data-handle="${grabbed}"]`)?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (grabbed === 'min') commit(Math.min(index, endIndex), endIndex);
    else commit(startIndex, Math.max(index, startIndex));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const index = indexFromClientX(e.clientX);
    if (dragging.current === 'min') commit(Math.min(index, endIndex), endIndex);
    else commit(startIndex, Math.max(index, startIndex));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const pageStep = Math.max(1, Math.round(lastIndex / 100));
  const onHandleKey = (which: 'min' | 'max') => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = which === 'min' ? startIndex : endIndex;
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1
      : e.key === 'PageUp' ? pageStep
      : e.key === 'PageDown' ? -pageStep
      : 0;
    let next: number;
    if (delta) next = current + delta;
    else if (e.key === 'Home') next = which === 'min' ? 0 : startIndex;
    else if (e.key === 'End') next = which === 'min' ? endIndex : lastIndex;
    else return;
    e.preventDefault();
    if (which === 'min') commit(clamp(next, 0, endIndex), endIndex);
    else commit(startIndex, clamp(next, startIndex, lastIndex));
  };

  const startPos = distances[startIndex] / total;
  const endPos = distances[endIndex] / total;

  if (points.length < 2) return null;

  return (
    <div className="route-trim">
      <div className="route-trim-head">
        <strong>Trim the ends</strong>
        {trim && (
          <button type="button" className="linkish" onClick={() => onChange(null)}>
            Reset
          </button>
        )}
      </div>
      <div className="range">
        <div
          className="range-track"
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div
            className="range-fill"
            style={{ left: `${startPos * 100}%`, right: `${(1 - endPos) * 100}%` }}
          />
          <div
            className="range-handle"
            data-handle="min"
            style={{ left: `${startPos * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Trim the start"
            aria-valuemin={0}
            aria-valuemax={Math.round(distances[endIndex])}
            aria-valuenow={Math.round(distances[startIndex])}
            aria-valuetext={units.distance(distances[startIndex])}
            onKeyDown={onHandleKey('min')}
          />
          <div
            className="range-handle"
            data-handle="max"
            style={{ left: `${endPos * 100}%` }}
            role="slider"
            tabIndex={0}
            aria-label="Trim the end"
            aria-valuemin={Math.round(distances[startIndex])}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(distances[endIndex])}
            aria-valuetext={units.distance(distances[endIndex])}
            onKeyDown={onHandleKey('max')}
          />
        </div>
        <div className="range-scale small muted" aria-hidden="true">
          <span>0</span>
          <span>{units.distance(total)}</span>
        </div>
      </div>
      <p className="route-trim-summary">
        {trim
          ? `Keeping ${units.distance(distances[endIndex] - distances[startIndex])} — ${units.distance(distances[startIndex])} off the start, ${units.distance(total - distances[endIndex])} off the end.`
          : 'Drag the handles to cut the start or end — the grey part on the map and profile is dropped.'}
      </p>
    </div>
  );
}
