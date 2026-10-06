/**
 * Product analytics, all optional and all switched on by build-time settings
 * (see README "Analytics"), so a fork or a local build sends nothing.
 *
 * - VITE_CF_ANALYTICS_TOKEN: Cloudflare Web Analytics. Visits, pages,
 *   countries, referrers and load speed. No cookies, no personal data. (On
 *   Cloudflare Pages it can also be switched on with one click instead.)
 * - VITE_CLARITY_ID: Microsoft Clarity. Heatmaps, scroll depth, rage clicks
 *   and session replays with typed text masked. Free. Set its project to
 *   "cookies off" so it stays cookieless.
 *
 * `track` records the handful of actions that say whether the product works
 * (searching, opening and downloading routes, contributing). Events go to
 * Clarity as custom events; with nothing configured it does nothing.
 */

const CF_TOKEN = (import.meta.env.VITE_CF_ANALYTICS_TOKEN as string | undefined) || '';
const CLARITY_ID = (import.meta.env.VITE_CLARITY_ID as string | undefined) || '';

/** What the privacy page should say is running. */
export const ANALYTICS = { cloudflare: Boolean(CF_TOKEN), clarity: Boolean(CLARITY_ID) };

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };
declare global {
  interface Window {
    clarity?: ClarityFn;
  }
}

function addScript(src: string, attributes: Record<string, string> = {}) {
  const script = document.createElement('script');
  script.async = true;
  script.defer = true;
  script.src = src;
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  document.head.appendChild(script);
}

let started = false;

/** Start whatever is configured, after the page has painted, so it never slows the first view. */
export function initAnalytics(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  if (!CF_TOKEN && !CLARITY_ID) return;
  const start = () => {
    if (CF_TOKEN) addScript('https://static.cloudflareinsights.com/beacon.min.js', { 'data-cf-beacon': JSON.stringify({ token: CF_TOKEN, spa: true }) });
    if (CLARITY_ID) {
      // Clarity's queue stub: calls made before its script arrives are replayed.
      const queue: ClarityFn = (...args: unknown[]) => {
        (queue.q ??= []).push(args);
      };
      window.clarity ??= queue;
      addScript(`https://www.clarity.ms/tag/${encodeURIComponent(CLARITY_ID)}`);
    }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 4000 });
  else setTimeout(start, 2000);
}

export type TrackedEvent =
  | 'search'
  | 'route_open'
  | 'gpx_download'
  | 'gpx_upload'
  | 'photo_upload'
  | 'review_post'
  | 'report_sent'
  | 'map_expand';

/** Record one product action (and an optional short label, e.g. the route). */
export function track(event: TrackedEvent, label?: string): void {
  if (!CLARITY_ID || typeof window === 'undefined' || !window.clarity) return;
  window.clarity('event', event);
  if (label) window.clarity('set', event, label.slice(0, 80));
}
