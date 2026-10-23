import { geocodePlace, regionBounds } from './regions';
import type { Bounds } from './venues';
import { countrySummaries } from './worldPeaks';

/**
 * Which country the visitor is in, without asking for their location: what
 * "Routes near me" falls back on when location is denied or unavailable.
 *
 * 1. On hillgpx.com, `/api/country` (functions/api/country.js) answers with
 *    the country Cloudflare already reads from the connection. Nothing new is
 *    collected and no third party is asked.
 * 2. Anywhere else (localhost, the GitHub Pages copy), or if that fails: the
 *    device's time zone, looked up in a table built from the IANA zone.tab
 *    (scripts/build_timezones.py), loaded only when needed.
 *
 * Answers an ISO 3166 alpha-2 code, or null when neither knows.
 */
export function detectCountry(): Promise<string | null> {
  detected ??= fromCloudflare().then((code) => code ?? fromTimeZone());
  return detected;
}
let detected: Promise<string | null> | undefined;

const ISO_CODE = /^[A-Z]{2}$/;
/** Cloudflare's codes for "unknown" and "Tor": not a country. */
const NOT_COUNTRIES = new Set(['XX', 'T1']);

async function fromCloudflare(): Promise<string | null> {
  try {
    const response = await fetch('/api/country', { cache: 'no-store' });
    // Off Cloudflare the path is the app's own page or a 404, not JSON.
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const { country } = (await response.json()) as { country?: unknown };
    return typeof country === 'string' && ISO_CODE.test(country) && !NOT_COUNTRIES.has(country) ? country : null;
  } catch {
    return null;
  }
}

export async function fromTimeZone(zone = Intl.DateTimeFormat().resolvedOptions().timeZone): Promise<string | null> {
  if (!zone) return null;
  const { default: table } = await import('./timeZoneCountries.json');
  return (table as Record<string, string>)[zone] ?? null;
}

export interface CountryArea {
  code: string;
  name: string;
  bounds: Bounds;
}

const displayNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;

/**
 * A country's name and the box to frame for it: the hand-drawn box when there
 * is one (Singapore, Malaysia …), else the box round its mapped summits, else
 * whatever the geocoder says. Null when nothing knows the country.
 */
export async function countryArea(code: string): Promise<CountryArea | null> {
  const summary = (await countrySummaries()).find((country) => country.code === code);
  const name = summary?.name ?? displayNames?.of(code) ?? code;
  const bounds = regionBounds(name) ?? summary?.bounds ?? (await geocodePlace(name).catch(() => null));
  return bounds ? { code, name, bounds } : null;
}
