import type { Venue } from '../types';
import { haversineM } from './elevation';
import { DATA_BASE } from './venues';

/**
 * Free, keyless context for a venue page, fetched on demand from Wikimedia's
 * CORS-enabled APIs: a Wikipedia summary when an article sits at the venue,
 * and open-licence Commons photos taken nearby when nobody has added one.
 * Both are credited on the page. AI-written summaries, generated at build
 * time by scripts/describe_venues.py, take precedence when present.
 */

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
}

export interface CommonsPhoto {
  url: string;
  pageUrl: string;
  artist: string;
  licence: string;
}

export interface GeneratedDescription {
  text: string;
  sources: string[];
}

const WIKI = 'https://en.wikipedia.org';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';

const STOPWORDS = /\b(mount|mt|gunung|bukit|bt|pulau|hill|peak|puncak|pico|monte|mont|berg|san|shan|yama|san|dake)\b/g;
const core = (name: string) =>
  name.toLowerCase().replace(/\(.*?\)/g, ' ').replace(STOPWORDS, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

function namesMatch(a: string, b: string): boolean {
  const x = core(a);
  const y = core(b);
  return x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

interface GeoSearch {
  query?: { geosearch?: { title: string; lat: number; lon: number; dist: number }[] };
}

interface RestSummary {
  title: string;
  extract?: string;
  type?: string;
  content_urls?: { desktop?: { page?: string } };
}

const summaryCache = new Map<string, Promise<WikiSummary | null>>();

/** The Wikipedia article about this venue, if one is within 5 km and shares its name. */
export function wikiSummary(venue: Venue): Promise<WikiSummary | null> {
  let pending = summaryCache.get(venue.slug);
  if (!pending) {
    pending = (async () => {
      const geo = await getJson<GeoSearch>(
        `${WIKI}/w/api.php?action=query&list=geosearch&gscoord=${venue.lat}|${venue.lng}&gsradius=5000&gslimit=20&format=json&origin=*`,
      );
      const hit = geo?.query?.geosearch?.find((page) => namesMatch(page.title, venue.name));
      if (!hit) return null;
      const summary = await getJson<RestSummary>(`${WIKI}/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`);
      if (!summary?.extract || summary.type === 'disambiguation') return null;
      return {
        title: summary.title,
        extract: summary.extract,
        url: summary.content_urls?.desktop?.page ?? `${WIKI}/wiki/${encodeURIComponent(hit.title)}`,
      };
    })();
    summaryCache.set(venue.slug, pending);
  }
  return pending;
}

interface CommonsResponse {
  query?: {
    pages?: Record<string, {
      title: string;
      imageinfo?: {
        thumburl?: string;
        descriptionurl?: string;
        extmetadata?: Record<string, { value?: string }>;
      }[];
      coordinates?: { lat: number; lon: number }[];
    }>;
  };
}

const OPEN_LICENCE = /^(cc by(-sa)?( \d\.\d)?|cc0|public domain|pd)/i;
const NOT_A_VIEW = /\b(map|sign|logo|diagram|plaque|chart|flag|coat of arms|locator)\b|\.(svg|pdf|tif)$/i;
const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const photoCache = new Map<string, Promise<CommonsPhoto[]>>();

/** Open-licence Commons photos taken within 1 km, sharpest first, as a fallback gallery. */
export function commonsPhotos(venue: Venue, limit = 6): Promise<CommonsPhoto[]> {
  let pending = photoCache.get(venue.slug);
  if (!pending) {
    pending = (async () => {
      const data = await getJson<CommonsResponse>(
        `${COMMONS}?action=query&generator=geosearch&ggscoord=${venue.lat}|${venue.lng}&ggsradius=1000&ggslimit=30&ggsnamespace=6` +
          `&prop=imageinfo|coordinates&iiprop=url|extmetadata&iiurlwidth=1280&format=json&origin=*`,
      );
      const pages = Object.values(data?.query?.pages ?? {});
      return pages
        .map((page) => {
          const info = page.imageinfo?.[0];
          const meta = info?.extmetadata ?? {};
          const licence = stripHtml(meta.LicenseShortName?.value ?? '');
          const coords = page.coordinates?.[0];
          return {
            title: page.title,
            distance: coords ? haversineM(venue.lng, venue.lat, coords.lon, coords.lat) : 1000,
            photo: info?.thumburl && info.descriptionurl
              ? { url: info.thumburl, pageUrl: info.descriptionurl, artist: stripHtml(meta.Artist?.value ?? 'Unknown'), licence }
              : null,
          };
        })
        .filter((item): item is { title: string; distance: number; photo: CommonsPhoto } =>
          Boolean(item.photo && OPEN_LICENCE.test(item.photo.licence) && !NOT_A_VIEW.test(item.title)))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map((item) => item.photo);
    })();
    photoCache.set(venue.slug, pending);
  }
  return pending;
}

let descriptionsPromise: Promise<Record<string, GeneratedDescription>> | null = null;

/** Build-time AI summaries (scripts/describe_venues.py); empty until that script has run. */
export function generatedDescription(slug: string): Promise<GeneratedDescription | null> {
  descriptionsPromise ??= fetch(`${DATA_BASE}/descriptions.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ descriptions: Record<string, GeneratedDescription> }>) : { descriptions: {} }))
    .then((data) => data.descriptions ?? {})
    .catch(() => ({}));
  return descriptionsPromise.then((all) => all[slug] ?? null);
}
