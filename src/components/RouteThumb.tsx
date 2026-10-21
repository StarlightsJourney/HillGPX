import { useEffect, useId, useMemo, useState } from 'react';
import type { Route } from '../types';
import { THUMB_H as H, THUMB_W as W, thumbPath, thumbView } from '../lib/thumbView';
import { communityThumbUrl, uploadRouteThumb } from '../lib/api';

/**
 * A route's own shape as its cover image.
 *
 * Routes have no photos, and a generic mountain stock image would say nothing
 * about which route this is. The trace is the one picture that is unique to
 * it, so the card draws it over the real terrain it crosses — a basemap
 * rendered once by `scripts/render_route_thumbs.ts` and stored, not rendered
 * per card — and its elevation silhouette. Routes without a stored image get
 * one rendered in the browser (see liveThumb); the plain grid only shows while
 * that render is under way or if it fails.
 */
/** Basemaps rendered in this browser this session, one per route and view, as object URLs. */
const liveThumbs = new Map<string, Promise<string | null>>();
/** One render at a time: each spins up a hidden MapLibre map and a WebGL context. */
let renderQueue: Promise<unknown> = Promise.resolve();

/**
 * Any route with a trace gets a map behind it. Routes saved on this device
 * have no stored image, and a stored one can be missing (a community upload
 * from before card images existed, a committed route changed since the last
 * `render_route_thumbs.ts` run). The card then renders the basemap here, the
 * same way the stored ones are made; a community route's render is also
 * uploaded, so later visitors get the stored image.
 */
function liveThumb(route: Route, key: string): Promise<string | null> {
  const id = `${route.slug}-${key}`;
  let pending = liveThumbs.get(id);
  if (!pending) {
    pending = renderQueue
      .then(() => import('../map/renderThumb'))
      .then(({ renderRouteThumb }) => renderRouteThumb(route))
      .then((thumb) => {
        if (!thumb) return null;
        if (route.source === 'community' && route.gpxUrl) void uploadRouteThumb(route.slug, thumb.key, thumb.blob).catch(() => undefined);
        return URL.createObjectURL(thumb.blob);
      })
      .catch(() => null);
    renderQueue = pending;
    liveThumbs.set(id, pending);
  }
  return pending;
}

export function RouteThumb({ route, animate = true }: { route: Route; animate?: boolean }) {
  const id = useId();
  const [imageFailed, setImageFailed] = useState(false);
  const [live, setLive] = useState<{ id: string; url: string } | null>(null);
  const shape = useMemo(() => {
    const pts = route.coordinates;
    const view = thumbView(pts);
    if (!view) return null;
    const step = Math.max(1, Math.floor(pts.length / 400));
    const proj = pts
      .filter((_, i) => i % step === 0 || i === pts.length - 1)
      .map((p) => view.project(p[0], p[1]));
    const line = proj.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

    const eles = pts.map((p) => p[2]);
    const lo = Math.min(...eles);
    const span = Math.max(Math.max(...eles) - lo, 5);
    const eleStep = Math.max(1, Math.floor(pts.length / 120));
    const sampled = eles.filter((_, i) => i % eleStep === 0);
    const profile =
      sampled
        .map((e, i) => `${i ? 'L' : 'M'}${((i / (sampled.length - 1)) * W).toFixed(1)} ${(H - 6 - ((e - lo) / span) * 48).toFixed(1)}`)
        .join(' ') + ` L${W} ${H} L0 ${H} Z`;

    // Committed routes ship their basemap with the site; community uploads have
    // one rendered in the uploader's browser and stored in Supabase.
    const image = route.source === 'community' && route.gpxUrl
      ? communityThumbUrl(route.slug, view.key)
      : `${import.meta.env.BASE_URL}${thumbPath(route.slug, view)}`;
    return { line, profile, start: proj[0], end: proj[proj.length - 1], image, viewKey: view.key, key: `${route.slug}-${view.key}` };
  }, [route.coordinates, route.slug, route.source, route.gpxUrl]);

  // No stored image to show: render one here.
  const needsLive = Boolean(shape) && (route.source === 'local' || imageFailed);
  useEffect(() => {
    if (!needsLive || !shape) return;
    let cancelled = false;
    void liveThumb(route, shape.viewKey).then((url) => {
      if (!cancelled && url) setLive({ id: shape.key, url });
    });
    return () => {
      cancelled = true;
    };
  }, [needsLive, shape, route]);

  if (!shape) return <span className="route-thumb" />;
  const liveUrl = live?.id === shape.key ? live.url : null;
  const href = liveUrl ?? (route.source !== 'local' && !imageFailed ? shape.image : null);
  const showImage = Boolean(href);

  return (
    <span className={`route-thumb${animate ? ' animate' : ''}${showImage ? ' has-map' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Map trace of ${route.name}`}>
        <defs>
          <pattern id={`${id}-grid`} width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="currentColor" strokeOpacity="0.06" />
          </pattern>
          <linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity={showImage ? 0.45 : 0.28} />
            <stop offset="1" stopColor="var(--accent)" stopOpacity={showImage ? 0.15 : 0.04} />
          </linearGradient>
        </defs>
        {href ? (
          <image
            key={href}
            href={href}
            width={W}
            height={H}
            preserveAspectRatio="none"
            className="route-thumb-map"
            onError={() => {
              if (!liveUrl) setImageFailed(true);
            }}
          />
        ) : (
          <rect width={W} height={H} fill={`url(#${id}-grid)`} />
        )}
        <path d={shape.profile} fill={`url(#${id}-fade)`} />
        <path className="route-thumb-casing" d={shape.line} pathLength={1} />
        <path className="route-thumb-line" d={shape.line} pathLength={1} />
        <circle className="route-thumb-end" cx={shape.end[0]} cy={shape.end[1]} r="6" />
        <circle className="route-thumb-start" cx={shape.start[0]} cy={shape.start[1]} r="7" />
      </svg>
    </span>
  );
}
