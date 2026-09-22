import { useId, useMemo } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { RoutePoint } from '../types';
import { haversineM } from '../lib/elevation';
import { useUnits } from './UnitsContext';

interface ElevationProfileProps {
  points: RoutePoint[];
  height?: number;
  hoverIndex?: number | null;
  /** Called with the point index the pointer is over, for map cross-highlighting. */
  onHoverIndex?: (index: number | null) => void;
}

/**
 * Elevation profile, drawn as inline SVG.
 *
 * The x axis is cumulative *distance*, not point index — sampling is rarely
 * uniform, and an index axis silently stretches the slow parts of a route and
 * compresses the fast ones, which makes gradients look wrong.
 */
export function ElevationProfile({
  points,
  height = 120,
  hoverIndex = null,
  onHoverIndex,
}: ElevationProfileProps) {
  // Labels and the hover tooltip change with units. The path itself is drawn in
  // a unitless 1000×100 box, so its geometry does not need recomputing.
  const units = useUnits();
  const gradientId = useId();

  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const distances: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      distances.push(
        distances[i - 1] + haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]),
      );
    }
    const total = distances[distances.length - 1] || 1;
    const elevations = points.map((point) => point[2]);
    const minEle = Math.min(...elevations);
    const maxEle = Math.max(...elevations);
    // Guard against a flat route collapsing to a zero-height band.
    const span = Math.max(maxEle - minEle, 5);
    const W = 1000;
    const H = 100;
    const coords = points.map((point, index) => [
      (distances[index] / total) * W,
      H - ((point[2] - minEle) / span) * H,
    ] as const);
    const line = coords
      .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' ');
    return {
      line,
      area: `${line} L${W} ${H} L0 ${H} Z`,
      minEle,
      maxEle,
      total,
      distances,
      coords,
      W,
      H,
    };
  }, [points]);

  if (!geometry) return <p className="muted small">Not enough points to draw a profile.</p>;

  const { line, area, minEle, maxEle, total, distances, coords, W, H } = geometry;
  const activeIndex = hoverIndex == null ? null : Math.max(0, Math.min(points.length - 1, hoverIndex));
  const active = activeIndex == null ? null : (() => {
    const lo = Math.max(0, activeIndex - 5);
    const hi = Math.min(points.length - 1, activeIndex + 5);
    const run = Math.max(1, distances[hi] - distances[lo]);
    const grade = Math.round(((points[hi][2] - points[lo][2]) / run) * 100);
    return {
      x: coords[activeIndex][0],
      y: coords[activeIndex][1],
      label: `${units.distance(distances[activeIndex])} · ${units.height(points[activeIndex][2])} · ${grade}%`,
    };
  })();

  const handleMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!onHoverIndex) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const targetDist = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * total;
    // Distances are monotonic, so a binary search would work; linear is fine
    // at these sizes and keeps the intent obvious.
    let best = 0;
    for (let i = 1; i < distances.length; i++) {
      if (Math.abs(distances[i] - targetDist) < Math.abs(distances[best] - targetDist)) best = i;
    }
    onHoverIndex(best);
  };

  return (
    <div className="profile">
      <div className="profile-chart">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ height, width: '100%', display: 'block' }}
          onPointerMove={handleMove}
          onPointerLeave={() => onHoverIndex?.(null)}
          role="img"
          aria-label={`Elevation profile, ${units.height(minEle)} to ${units.height(maxEle)}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          {active && (
            <>
              <line className="profile-guide" x1={active.x} x2={active.x} y1={0} y2={H} />
              <circle className="profile-dot" cx={active.x} cy={active.y} r={5} />
            </>
          )}
        </svg>
        <div className="profile-y-labels" aria-hidden="true">
          <span>{units.height(maxEle)}</span>
          <span>{units.height(minEle)}</span>
        </div>
        {active && (
          <span className="profile-tooltip" style={{ left: `${(active.x / W) * 100}%` }}>
            {active.label}
          </span>
        )}
      </div>
      <div className="profile-axis" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <span key={index}>{units.distance((total * index) / 4)}</span>
        ))}
      </div>
    </div>
  );
}
