import { useId, useMemo } from 'react';
import type { RoutePoint } from '../types';
import { haversineM } from '../lib/elevation';
import { useUnits } from './UnitsContext';

interface ElevationProfileProps {
  points: RoutePoint[];
  height?: number;
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
export function ElevationProfile({ points, height = 120, onHoverIndex }: ElevationProfileProps) {
  // Only the three axis labels change with units. The path itself is drawn in a
  // unitless 1000×100 box, so nothing about the geometry has to be recomputed.
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
    const eles = points.map((p) => p[2]);
    const minEle = Math.min(...eles);
    const maxEle = Math.max(...eles);
    // Guard against a flat route collapsing to a zero-height band.
    const span = Math.max(maxEle - minEle, 5);

    const W = 1000;
    const H = 100;
    const coords = points.map((p, i) => {
      const x = (distances[i] / total) * W;
      const y = H - ((p[2] - minEle) / span) * H;
      return [x, y] as const;
    });

    const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    const area = `${line} L${W} ${H} L0 ${H} Z`;

    return { line, area, minEle, maxEle, total, distances, W, H };
  }, [points]);

  if (!geometry) {
    return <p className="muted small">Not enough points to draw a profile.</p>;
  }

  const { line, area, minEle, maxEle, total, distances, W, H } = geometry;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onHoverIndex) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const targetDist = frac * total;
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
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height, width: '100%', display: 'block' }}
        onMouseMove={handleMove}
        onMouseLeave={() => onHoverIndex?.(null)}
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
        <path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="profile-axis small muted">
        <span>{units.height(minEle)}</span>
        <span>{units.distance(total)}</span>
        <span>{units.height(maxEle)}</span>
      </div>
    </div>
  );
}
