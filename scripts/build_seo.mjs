#!/usr/bin/env node
/* global process, console */
/**
 * Pages search engines and AI assistants can read.
 *
 * The app keeps places and routes behind `#venue/…` addresses, which search
 * engines treat as one page (the home page). After `vite build`, this writes
 * a small static page for every hill, every summit in the world-peaks index,
 * every country and every committed route into `dist/`, each with a real
 * title, description, link-preview tags and schema.org data, and a button
 * into the live map. It also writes `sitemap.xml`, `robots.txt` and
 * `llms.txt`.
 *
 * Site address: SITE_URL (the deploy workflow sets it from public/CNAME, or the
 * GitHub Pages address), defaulting to the Pages address.
 *
 * Usage: node scripts/build_seo.mjs   (run by `npm run build`)
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const DATA = join(ROOT, 'public', 'data');
const SITE = (process.env.SITE_URL || process.env.VITE_SITE_URL || 'https://hillgpx.com').replace(/\/+$/, '');
const TODAY = new Date().toISOString().slice(0, 10);
const TILE = 5;
// Cloudflare Pages' free plan takes at most 20,000 files per deployment.
// Place pages fill whatever room the app leaves, most useful first.
const MAX_FILES = Number(process.env.MAX_SITE_FILES || 19500);

if (!existsSync(DIST)) {
  console.error('dist/ is missing: run vite build first.');
  process.exit(1);
}
// Start from the app alone, so a second run does not count its own pages.
for (const dir of ['place', 'country', 'route']) rmSync(join(DIST, dir), { recursive: true, force: true });

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const venues = readJson(join(DATA, 'venues.json')).venues;
const routesFile = readJson(join(DATA, 'routes.json'));
const routes = Array.isArray(routesFile) ? routesFile : routesFile.routes;
const descriptions = existsSync(join(DATA, 'descriptions.json')) ? readJson(join(DATA, 'descriptions.json')).descriptions ?? {} : {};
const index = readJson(join(DATA, 'peaks', 'index.json'));
const peakPhotos = existsSync(join(DATA, 'peaks', 'photos.json')) ? readJson(join(DATA, 'peaks', 'photos.json')).photos ?? {} : {};
const regionName = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code) => {
  try {
    return regionName.of(code) ?? code;
  } catch {
    return code;
  }
};

const escape = (text) =>
  String(text ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const metres = (m) => `${Math.round(m).toLocaleString('en')} m`;
const km = (m) => `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
const token = (n) => (n < 0 ? `m${-n}` : String(n));
const peakSlug = (id, lat, lng) => `gn${id}-${token(Math.floor(lat / TILE) * TILE)}x${token(Math.floor(lng / TILE) * TILE)}`;
const appLink = (hash) => `${SITE}/${hash}`;

function photoUrl(file) {
  if (!file) return null;
  return /^https?:/.test(file) ? file : `${SITE}/${file.replace(/^\/+/, '')}`;
}

const STYLE = `
:root{--ink:#222;--muted:#6a6a6a;--accent:#c1502e;--line:#ebebeb}
*{box-sizing:border-box}body{margin:0;font:16px/1.6 Figtree,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:var(--ink);background:#fff}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;max-width:880px;margin:0 auto;padding:18px 20px;border-bottom:1px solid var(--line)}
.brand{display:inline-flex;align-items:center;gap:8px;color:var(--accent);font-weight:700;font-size:21px;text-decoration:none;letter-spacing:-.03em}
.brand svg{width:28px;height:28px}
main{max-width:880px;margin:0 auto;padding:28px 20px 56px}
nav.crumbs{font-size:14px;color:var(--muted);margin-bottom:12px}nav.crumbs a{color:var(--muted)}
h1{margin:0 0 6px;font-size:34px;line-height:1.15;letter-spacing:-.02em}
.sub{margin:0 0 20px;color:var(--muted)}
.facts{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px;padding:0;list-style:none}
.facts li{padding:10px 14px;border:1px solid var(--line);border-radius:12px;font-size:14px}.facts strong{display:block;font-size:18px}
figure{margin:0 0 22px}figure img{width:100%;max-height:440px;object-fit:cover;border-radius:16px;background:#f2f2f2}
figcaption{margin-top:6px;color:var(--muted);font-size:12px}
.cta{display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 22px;border-radius:10px;background:var(--ink);color:#fff;font-weight:600;text-decoration:none}
.cta:hover{background:#000}
ul.list{padding-left:20px}ul.list li{margin:4px 0}ul.list a{color:var(--ink)}
footer{max-width:880px;margin:0 auto;padding:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}footer a{color:var(--muted)}
`;
const MARK = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#c1502e"/><path d="M9.75 7.5h2A1.25 1.25 0 0 1 13 8.75V15l3-3.25 3 3.25V8.75a1.25 1.25 0 0 1 1.25-1.25h2a1.25 1.25 0 0 1 1.25 1.25v14.5a1.25 1.25 0 0 1-1.25 1.25h-2A1.25 1.25 0 0 1 19 23.25V19H13v4.25a1.25 1.25 0 0 1-1.25 1.25h-2A1.25 1.25 0 0 1 8.5 23.25V8.75A1.25 1.25 0 0 1 9.75 7.5z" fill="#fff"/></svg>';

const pages = [];

function page({ path, title, description, image, jsonLd, body }) {
  const url = `${SITE}/${path}`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="${SITE}/favicon.svg" type="image/svg+xml">
<meta property="og:site_name" content="hillGPX">
<meta property="og:type" content="website">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${escape(image || `${SITE}/og-image.png`)}">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>${STYLE}</style>
</head>
<body>
<header><a class="brand" href="${SITE}/">${MARK}hillGPX</a><a href="${SITE}/#map">Open the map</a></header>
<main>
${body}
</main>
<footer>hillGPX is a free, open-source map of hills, mountains and GPX routes. Map data © OpenStreetMap contributors; summits from GeoNames (CC BY 4.0); photos credited on each page. <a href="${SITE}/#terms">Licences</a> · <a href="${SITE}/#privacy">Privacy</a></footer>
</body>
</html>
`;
  const file = join(DIST, path, 'index.html');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
  pages.push(url);
}

const crumbs = (items) =>
  `<nav class="crumbs"><a href="${SITE}/">hillGPX</a>${items.map(([label, href]) => ` › ${href ? `<a href="${href}">${escape(label)}</a>` : escape(label)}`).join('')}</nav>`;
const breadcrumbLd = (items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [['hillGPX', `${SITE}/`], ...items].map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(item ? { item } : {}) })),
});

function placePage({ slug, name, lat, lng, heightM, kind, country, countryCode, text, photo, routesHere }) {
  const where = country ? ` in ${country}` : '';
  const heightText = heightM ? `${metres(heightM)} ${kind === 'hill' ? 'summit' : 'climb'}` : 'climb';
  const description = text || `${name} is a ${heightText}${where}. See it on the hillGPX map with routes, photos, weather and directions.`;
  const image = photo ? photoUrl(photo.file) : null;
  const countryHref = countryCode ? `${SITE}/country/${countryCode.toLowerCase()}/` : null;
  placeUrlBySlug.set(slug, `${SITE}/place/${slug}/`);
  page({
    path: `place/${slug}/`,
    title: `${name}${heightM ? ` (${metres(heightM)})` : ''}${where} · hillGPX`,
    description: description.slice(0, 300),
    image,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': ['Place', 'TouristAttraction'],
          name,
          description,
          url: `${SITE}/place/${slug}/`,
          geo: { '@type': 'GeoCoordinates', latitude: lat, longitude: lng, ...(heightM ? { elevation: heightM } : {}) },
          ...(country ? { containedInPlace: { '@type': 'Country', name: country } } : {}),
          ...(image ? { image } : {}),
          isAccessibleForFree: true,
        },
        breadcrumbLd([...(country ? [[country, countryHref]] : []), [name, null]]),
      ],
    },
    body: `${crumbs([...(country ? [[country, countryHref]] : []), [name]])}
<h1>${escape(name)}</h1>
<p class="sub">${escape(kind === 'hill' ? 'Hill or mountain' : 'Climb')}${escape(where)}</p>
<ul class="facts">${heightM ? `<li><strong>${metres(heightM)}</strong>elevation</li>` : ''}<li><strong>${lat.toFixed(4)}, ${lng.toFixed(4)}</strong>coordinates</li>${routesHere.length ? `<li><strong>${routesHere.length}</strong>GPX route${routesHere.length === 1 ? '' : 's'}</li>` : ''}</ul>
${image ? `<figure><img src="${escape(image)}" alt="${escape(name)}" loading="lazy"><figcaption>${escape([photo.credit && `Photo by ${photo.credit}`, photo.license || photo.licence, photo.source].filter(Boolean).join(' · '))}</figcaption></figure>` : ''}
<p>${escape(description)}</p>
${routesHere.length ? `<h2>GPX routes here</h2><ul class="list">${routesHere.map((route) => `<li><a href="${SITE}/route/${route.slug}/">${escape(route.name)}</a> · ${km(route.distanceM)}</li>`).join('')}</ul>` : ''}
<p><a class="cta" href="${appLink(`#venue/${slug}`)}">Open ${escape(name)} on the map</a></p>`,
  });
}

const placeUrlBySlug = new Map();
const placeSpecs = [];
// Coarse country boxes for the local hills (the same ones src/lib/regions.ts
// uses to label cards), checked in order.
const REGIONS = [
  ['Singapore', 103.6, 1.16, 104.1, 1.48], ['Hong Kong', 113.82, 22.15, 114.44, 22.57], ['Taiwan', 119.3, 21.8, 122.1, 25.4],
  ['Malaysia', 99.6, 0.85, 119.3, 7.4], ['Thailand', 97.3, 5.6, 105.7, 20.5], ['Vietnam', 102.1, 8.4, 109.5, 23.4],
  ['Philippines', 116.9, 4.6, 126.6, 21.1], ['Indonesia', 95, -11, 141, 6], ['Japan', 129.4, 30.9, 145.9, 45.6],
  ['South Korea', 125.8, 33.1, 129.6, 38.7], ['Australia', 112.9, -43.7, 153.7, -10.6], ['New Zealand', 166.4, -47.3, 178.6, -34.4],
];
const regionOf = (lng, lat) => REGIONS.find(([, w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n)?.[0] ?? null;
const routesByVenue = new Map();
for (const route of routes) for (const slug of route.venueSlugs ?? []) routesByVenue.set(slug, [...(routesByVenue.get(slug) ?? []), route]);

// Hills and mountains in the local data (blocks and stairwells are thousands of
// near-identical pages, so they stay in the app).
for (const venue of venues) {
  if (venue.type !== 'hill' || /^[\d\s.,m]+$/i.test(venue.name)) continue;
  const text = descriptions[venue.slug]?.text || (venue.notes && !venue.notes.startsWith('Summit elevation from') ? venue.notes : '');
  placeSpecs.push({
    slug: venue.slug,
    name: venue.name,
    lat: venue.lat,
    lng: venue.lng,
    heightM: venue.summitM ?? venue.gainM,
    kind: 'hill',
    country: regionOf(venue.lng, venue.lat),
    countryCode: null,
    text,
    photo: venue.photo,
    routesHere: routesByVenue.get(venue.slug) ?? [],
  });
}

// The world's tallest summits from the peaks index.
const peaksByCountry = new Map();
for (const [id, name, lat, lng, ele, , code, feature] of index.top) {
  // Ranges (MTS, HLLS) are areas, not summits you can stand on.
  if (feature === 'MTS' || feature === 'HLLS') continue;
  const slug = peakSlug(id, lat, lng);
  const stored = peakPhotos[slug];
  const photo = stored ? { file: stored[0], credit: stored[2], licence: stored[3], source: 'Wikimedia Commons' } : null;
  const country = code ? countryName(code) : null;
  placeSpecs.push({ slug, name, lat, lng, heightM: ele, kind: 'hill', country, countryCode: code || null, text: descriptions[slug]?.text || '', photo, routesHere: [] });
  if (code) peaksByCountry.set(code, [...(peaksByCountry.get(code) ?? []), { slug, name, ele, lat, lng }]);
}

// The local data's hills (Mount Fuji among them) are not in the world index,
// so add them to their country's list too.
const codeByName = new Map(Object.keys(index.byCountry).map((code) => [countryName(code), code]));
for (const venue of venues) {
  if (venue.type !== 'hill' || !venue.summitM) continue;
  const code = codeByName.get(regionOf(venue.lng, venue.lat));
  if (code) peaksByCountry.set(code, [...(peaksByCountry.get(code) ?? []), { slug: venue.slug, name: venue.name, ele: venue.summitM, lat: venue.lat, lng: venue.lng }]);
}

// Write the place pages that fit: places with routes, a photo or a written
// description first, then the tallest.
const countFiles = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((n, entry) => n + (entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1), 0);
const reserved = countFiles(DIST) + Object.keys(index.byCountry).length + routes.length + 4;
const room = Math.max(0, MAX_FILES - reserved);
const score = (spec) => (spec.routesHere.length ? 4 : 0) + (spec.photo ? 2 : 0) + (spec.text ? 1 : 0);
placeSpecs.sort((a, b) => score(b) - score(a) || (b.heightM ?? 0) - (a.heightM ?? 0));
for (const spec of placeSpecs.slice(0, room)) placePage(spec);
if (placeSpecs.length > room) console.warn(`SEO: ${(placeSpecs.length - room).toLocaleString('en')} place pages left out to stay under ${MAX_FILES.toLocaleString('en')} files.`);

// One page per country: its tallest summits.
for (const [code, [count]] of Object.entries(index.byCountry)) {
  const name = countryName(code);
  // Tallest first, skipping points within 3 km of a taller one (a summit's own sub-peaks).
  const peaks = [];
  for (const peak of (peaksByCountry.get(code) ?? []).sort((a, b) => b.ele - a.ele)) {
    const near = peaks.some((other) => 6371000 * Math.hypot(((peak.lat - other.lat) * Math.PI) / 180, (((peak.lng - other.lng) * Math.PI) / 180) * Math.cos((peak.lat * Math.PI) / 180)) < 3000);
    if (!near) peaks.push(peak);
    if (peaks.length === 40) break;
  }
  if (peaks.length === 0) continue;
  const description = `The highest peaks in ${name}, from ${peaks[0].name} (${metres(peaks[0].ele)}) down. ${count.toLocaleString('en')} summits in ${name} are on the hillGPX map, with GPX routes, photos and weather.`;
  const [, west, south, east, north] = index.byCountry[code];
  page({
    path: `country/${code.toLowerCase()}/`,
    title: `Highest peaks in ${name} · hillGPX`,
    description,
    image: photoUrl(peakPhotos[peaks[0].slug]?.[0]),
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'ItemList',
          name: `Highest peaks in ${name}`,
          itemListElement: peaks.map((peak, i) => ({ '@type': 'ListItem', position: i + 1, name: peak.name, url: placeUrlBySlug.get(peak.slug) ?? appLink(`#venue/${peak.slug}`) })),
        },
        breadcrumbLd([[name, null]]),
      ],
    },
    body: `${crumbs([[name]])}
<h1>Highest peaks in ${escape(name)}</h1>
<p class="sub">${count.toLocaleString('en')} summits mapped</p>
<p>${escape(description)}</p>
<ul class="list">${peaks.map((peak) => `<li><a href="${placeUrlBySlug.get(peak.slug) ?? appLink(`#venue/${peak.slug}`)}">${escape(peak.name)}</a> · ${metres(peak.ele)}</li>`).join('')}</ul>
<p><a class="cta" href="${appLink(`#map/${[west, south, east, north].map((n) => n.toFixed(4)).join(',')}`)}">See ${escape(name)} on the map</a></p>`,
  });
}

// Committed GPX routes.
for (const route of routes) {
  const passes = (route.venueSlugs ?? []).map((slug) => venues.find((venue) => venue.slug === slug)).filter(Boolean);
  const where = route.country ? ` in ${route.country}` : '';
  const description =
    route.description ||
    `${route.name}: a ${km(route.distanceM)}${route.loop ? ' loop' : ' point-to-point route'}${where}${route.elevationAvailable !== false ? ` with ${metres(route.gainM)} of elevation gain` : ''}. Free GPX download on hillGPX.`;
  page({
    path: `route/${route.slug}/`,
    title: `${route.name} (${km(route.distanceM)}) GPX · hillGPX`,
    description,
    image: null,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'CreativeWork', name: route.name, description, url: `${SITE}/route/${route.slug}/`, isAccessibleForFree: true, ...(route.licence ? { license: route.licence } : {}) },
        breadcrumbLd([[route.name, null]]),
      ],
    },
    body: `${crumbs([['Routes', `${SITE}/#routes`], [route.name]])}
<h1>${escape(route.name)}</h1>
<p class="sub">GPX route${escape(where)}</p>
<ul class="facts"><li><strong>${km(route.distanceM)}</strong>distance</li>${route.elevationAvailable !== false ? `<li><strong>${metres(route.gainM)}</strong>elevation gain</li><li><strong>${metres(route.lossM)}</strong>elevation loss</li>` : ''}<li><strong>${route.loop ? 'Loop' : 'Point to point'}</strong>shape</li></ul>
<p>${escape(description)}</p>
${passes.length ? `<h2>Passes</h2><ul class="list">${passes.map((venue) => `<li><a href="${placeUrlBySlug.get(venue.slug) ?? appLink(`#venue/${venue.slug}`)}">${escape(venue.name)}</a></li>`).join('')}</ul>` : ''}
${route.licence ? `<p class="sub">Licence: ${escape(route.licence)}</p>` : ''}
<p><a class="cta" href="${appLink('#routes')}">Open the route map and download the GPX</a></p>`,
  });
}

// The address list for search engines, the rules for crawlers, and a plain
// summary for AI assistants.
const urls = [`${SITE}/`, ...pages];
writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `<url><loc>${url}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}\n</urlset>\n`,
);
// Everyone may read everything; the AI search crawlers are named so it is
// unmistakable that they are welcome.
const AI_CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bingbot'];
writeFileSync(
  join(DIST, 'robots.txt'),
  `User-agent: *\nAllow: /\n\n${AI_CRAWLERS.map((bot) => `User-agent: ${bot}\nAllow: /`).join('\n\n')}\n\nSitemap: ${SITE}/sitemap.xml\n`,
);
const topCountries = Object.entries(index.byCountry).sort((a, b) => b[1][0] - a[1][0]).slice(0, 12);
writeFileSync(
  join(DIST, 'llms.txt'),
  `# hillGPX

> A free, open-source map of ${index.total.toLocaleString('en')}+ hills and mountains in ${index.countries} countries, plus Singapore's stairwells and tall HDB blocks, with a community archive of GPX routes up them. Every route is free to download and keeps honest elevation (EG/EL).

- Home and map: ${SITE}/
- Routes: ${SITE}/#routes
- Every place has a page at ${SITE}/place/<slug>/ and every country at ${SITE}/country/<iso-code>/
- Sitemap: ${SITE}/sitemap.xml
- Source code and data (MIT licence): https://github.com/StarlightsJourney/HillGPX

## Countries with the most mapped summits
${topCountries.map(([code, [count]]) => `- [${countryName(code)}](${SITE}/country/${code.toLowerCase()}/): ${count.toLocaleString('en')} summits`).join('\n')}

## GPX routes
${routes.map((route) => `- [${route.name}](${SITE}/route/${route.slug}/): ${km(route.distanceM)}, ${metres(route.gainM)} EG`).join('\n')}
`,
);

// A real "not found" page: without one, Cloudflare Pages answers every
// unknown address with the app and a 200, which search engines count as
// duplicate pages.
writeFileSync(
  join(DIST, '404.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found · hillGPX</title><meta name="robots" content="noindex"><style>${STYLE}</style></head><body><header><a class="brand" href="${SITE}/">${MARK}hillGPX</a></header><main><h1>That page is not here</h1><p class="sub">It may have moved, or the address has a typo.</p><p><a class="cta" href="${SITE}/">Go to hillGPX</a></p></main></body></html>\n`,
);

console.log(`SEO: ${pages.length.toLocaleString('en')} pages, sitemap with ${urls.length.toLocaleString('en')} URLs, robots.txt, llms.txt for ${SITE}`);
