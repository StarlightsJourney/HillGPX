import { useId, useMemo } from 'react';
import type { Route } from '../types';

const W = 400;
const H = 300;
const PAD = 34;

/**
 * A route's own shape as its cover image.
 *
 * Routes have no photos, and a generic mountain stock image would say nothing
 * about which route this is. The trace is the one picture that is unique to
 * it, so the card draws it — projected with the latitude correction so a loop
 * looks like a loop — over its elevation silhouette.
 */
export function RouteThumb({ route, animate = true }: { route: Route; animate?: boolean }) {
  const id = useId();
  const shape = useMemo(() => {
    const pts = route.coordinates;
    if (pts.length < 2) return null;
    const lats = pts.map((p) => p[1]);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const k = Math.cos((midLat * Math.PI) / 180);
    const xs = pts.map((p) => p[0] * k);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const scale = Math.min((W - PAD * 2) / Math.max(maxX - minX, 1e-6), (H - PAD * 2 - 40) / Math.max(maxY - minY, 1e-6));
    const offX = (W - (maxX - minX) * scale) / 2;
    const offY = (H - 40 - (maxY - minY) * scale) / 2;
    const step = Math.max(1, Math.floor(pts.length / 400));
    const proj = pts
      .filter((_, i) => i % step === 0 || i === pts.length - 1)
      .map((p) => [offX + (p[0] * k - minX) * scale, offY + (maxY - p[1]) * scale] as const);
    const line = proj.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

    const eles = pts.map((p) => p[2]);
    const lo = Math.min(...eles);
    const span = Math.max(Math.max(...eles) - lo, 5);
    const eleStep = Math.max(1, Math.floor(pts.length / 120));
    const sampled = eles.filter((_, i) => i % eleStep === 0);
    const profile =
      sampled
        .map((e, i) => `${i ? 'L' : 'M'}${((i / (sampled.length - 1)) * W).toFixed(1)} ${(H - 6 - ((e - lo) / span) * 56).toFixed(1)}`)
        .join(' ') + ` L${W} ${H} L0 ${H} Z`;

    return { line, profile, start: proj[0], end: proj[proj.length - 1] };
  }, [route.coordinates]);

  if (!shape) return <span className="route-thumb" />;

  return (
    <span className={`route-thumb${animate ? ' animate' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Map trace of ${route.name}`}>
        <defs>
          <pattern id={`${id}-grid`} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="currentColor" strokeOpacity="0.06" />
          </pattern>
          <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${id}-grid)`} />
        <path d={shape.profile} fill={`url(#${id}-fade)`} />
        <path className="route-thumb-casing" d={shape.line} pathLength={1} />
        <path className="route-thumb-line" d={shape.line} pathLength={1} />
        <circle className="route-thumb-end" cx={shape.end[0]} cy={shape.end[1]} r="6" />
        <circle className="route-thumb-start" cx={shape.start[0]} cy={shape.start[1]} r="7" />
      </svg>
    </span>
  );
}
