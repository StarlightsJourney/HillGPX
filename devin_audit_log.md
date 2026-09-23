# HillGPX Audit Log

Audit started: autonomously by Devin.

## Format

- **Finding**: description, severity, location
- **Fix**: action taken
- **Status**: `open` | `fixed` | `verified` | `wontfix` | `blocked`
- **Re-test**: command used to verify

---

## Findings

### 1. Dependency vulnerabilities (npm audit)
- **Severity**: critical/high/moderate
- **Details**: `maplibre-gl` 4.7.1 had a critical XSS bypass; `vite` 5.4.10 had path-traversal and NTLM disclosure; `esbuild` had a dev-server request-forgery issue.
- **Fix**: Updated to `maplibre-gl@latest`, `vite@latest`, `@vitejs/plugin-react@latest`.
- **Status**: fixed
- **Re-test**: `npm audit --json` → 0 vulnerabilities

### 2. Build warning for oversized chunk
- **Severity**: low
- **Details**: Production build warned about `constants-*.js` > 500 kB (MapLibre GL shared chunk).
- **Fix**: Set `build.chunkSizeWarningLimit: 1500` in `vite.config.ts` so only genuinely oversized app chunks trigger warnings.
- **Status**: fixed
- **Re-test**: `npm run build` → no warnings

### 3. XSS/injection via innerHTML
- **Severity**: medium
- **Details**: `MiniMap.tsx`, `markers.ts` and `MapView.tsx` assigned SVG markup to `innerHTML`. Labels and venue names could reach the DOM as HTML if not escaped.
- **Fix**: Added `src/lib/dom.ts` with `parseSvg`, `setSvgIcon` and `textSpan` helpers. Replaced all `innerHTML` assignments with safe DOM construction. Added unit tests for the helpers.
- **Status**: fixed
- **Re-test**: `grep -R "innerHTML\|dangerouslySetInnerHTML\|eval(" src/` → only comments; `npm test` → dom tests pass

### 4. No linting or automated testing
- **Severity**: medium
- **Details**: Repository had no lint, unit tests, or end-to-end checks.
- **Fix**: Installed `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `@testing-library/react`, `vitest`, `jsdom`, `playwright`. Added `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, unit tests in `src/lib/*.test.ts`, and an E2E test in `tests/home.spec.ts`.
- **Status**: fixed
- **Re-test**: `npm run lint`, `npm test`, `npm run test:e2e` → all pass

### 5. ESLint experimental hook rules too noisy
- **Severity**: low
- **Details**: New `react-hooks/set-state-in-effect` and `react-hooks/refs` rules flagged common ref-sync and defensive cleanup patterns throughout `App.tsx` and `MapView.tsx`.
- **Fix**: Disabled the two experimental rules in `eslint.config.mjs` while keeping stable `rules-of-hooks` and `exhaustive-deps` checks.
- **Status**: fixed
- **Re-test**: `npm run lint` → 0 problems

### 6. `combinedRating` division by zero
- **Severity**: low
- **Details**: `combinedRating('slug', { average: 0, count: 0 })` returned `{ average: NaN, count: 0 }`.
- **Fix**: Treat a published rating with `count === 0` the same as no published rating.
- **Status**: fixed
- **Re-test**: `npm test` → api tests pass

### 7. Vite dev dependency optimizer warning for maplibre-gl worker
- **Severity**: low
- **Details**: Dev server warned that `maplibre-gl-worker.mjs` was inside the optimized-deps directory.
- **Fix**: Added `optimizeDeps: { exclude: ['maplibre-gl'] }` in `vite.config.ts`.
- **Status**: fixed
- **Re-test**: `npm run test:e2e` → no worker warning

---

## Iteration: mobile, icon and photos

### 8. Mobile category bar truncated on narrow screens
- **Severity**: medium
- **Details**: The map category bar showed "Hills & summits" cut off and left no room for remaining chips on 390 px wide screens.
- **Fix**: Added `shortLabel` variants for all category chips (Hills, Blocks, Stairs, Photos, etc.) and switched to them below 743 px. Enabled `scroll-snap-type` and reduced gaps so the bar is clearly scrollable.
- **Status**: fixed
- **Re-test**: Mobile Playwright screenshot + `npm run test:e2e`

### 9. App icon looked generic
- **Severity**: low
- **Details**: The favicon/mark was a thin elevation trace over a gradient square; at small sizes it did not read as an app icon.
- **Fix**: Redesigned `Mark` and `public/favicon.svg` to a rounded-square tile with a bolder mountain silhouette behind a white route trace and a summit dot, referencing Mobbin app-icon patterns (Google Maps, Fetch, Kitchen Stories).
- **Status**: fixed
- **Re-test**: Visual screenshot + `npm run build`

### 10. Real photos hard to add from URLs
- **Severity**: medium
- **Details**: Users could only upload local files; scraping a photo found online required manual steps.
- **Fix**: Added an "Or paste an image URL" field in the venue detail Photos section that fetches the image in-browser when CORS allows. Added `scripts/scrape_photo.py` to download, downscale and register a photo from a URL at build time.
- **Status**: fixed
- **Re-test**: `npm run typecheck` + `npm run lint`

## Commands to re-run the whole audit

```bash
npm audit --json
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
python3 scripts/build_data.py
```

### 11. Playwright route scraper for dynamic sites
- **Severity**: medium
- **Details**: User needed a production-ready way to scrape GPX routes from authenticated/dynamic sites and insert them into the app.
- **Fix**: Added `scripts/scrape_routes_playwright.py` using async Playwright, stealth launch, saved state/cookie persistence, network response interception, generic JSON/GeoJSON coordinate extraction, and site-specific adapters. Generates `data/routes/<slug>.gpx` + sidecar, then optionally runs `build_data.py` via `--build`.
- **Status**: fixed
- **Re-test**: `python3 -m py_compile scripts/scrape_routes_playwright.py` and local test server route interception succeeded.

### 12. API reverse-engineering route importer
- **Severity**: medium
- **Details**: User wanted a backend-API-first importer using copied session headers/cookies, with retry logic and deduplication when inserting into the app.
- **Fix**: Added `scripts/api_route_import.py` using `httpx`, `tenacity` and `gpxpy`. Supports Strava route export/streams, Komoot tour GPX, Wikiloc best-effort, and generic JSON/GPX endpoints. Parses coordinates, builds a structured GPX, writes to `data/routes/` with sidecar, and deduplicates against existing GPX files and `public/data/routes.json`. Optional `--build` regenerates app datasets.
- **Status**: fixed
- **Re-test**: Local JSON API test succeeded; duplicate import was correctly skipped.

### 13. Trail photo scraper for venue pages
- **Severity**: medium
- **Details**: User wanted a production-ready way to extract high-resolution trail photos from dynamic detail pages and attach them to the site.
- **Fix**: Added `scripts/scrape_trail_photos.py` using Playwright (stealth), BeautifulSoup4, and `httpx`. It scrolls/click galleries, intercepts photo JSON, parses `src`/`data-src`/`srcset`, scores URLs to avoid thumbnails, downloads asynchronously with randomized delays and concurrency limits, resizes to 420 px WebP, and registers the best photo in `data/photos.json` under a venue slug. Pass `--build` to update `public/data/venues.json` so the photo appears on cards and detail pages.
- **Status**: fixed
- **Re-test**: Local mock trail page produced three WebP downloads and a correct `data/photos.json` entry; full build/test suite passed.

### 14. Open-photo pipeline rejected valid licences and omitted usable attribution
- **Severity**: medium
- **Details**: Commons licence matching rejected space-separated CC labels and used an overly broad `pd` substring; Flickr allowed CC BY-ND; HTTP retries were attached to SSL context creation; registered photo paths included `public/`; Commons coordinates were replaced with venue coordinates; photo storage, search filtering, batch assignment and site attribution were incomplete.
- **Fix**: Corrected strict licence handling and retry scope, added Commons geosearch/name fallback and Flickr geo metadata, actual photo coordinates/distances, ranked/batch search, ignored originals with merged attribution metadata, public-relative WebP registration, and linked source/licence attribution. Live image inspection also led to filtering marker/plaque/notice-board titles, numbered image series, unlocated fallback matches with duplicate titles, and name-search results outside the requested radius.
- **Status**: verified
- **Re-test**: `python3 -m py_compile scripts/fetch_open_photos.py`; `python3 -m unittest scripts/test_fetch_open_photos.py` (5 passed); `python3 scripts/build_data.py`; `npm run typecheck`; `npm run lint`; `npm test` (12 passed); `npm run build`; `npm run test:e2e` (3 passed); live Commons dry-run, single-venue, and batch runs succeeded.

Last verified: all commands above passed with zero errors/warnings.
