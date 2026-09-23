# Data scripts

All generated outputs are committed. The app does not run Python or need these credentials.

| Script | Purpose | Reads | Writes | Network and credentials | How often |
|---|---|---|---|---|---|
| `build_data.py` | Merge venues, photos, ratings and routes; simplify and profile routes; tag route country; build landing statistics | `data/venues/*.json`, `data/photos.json`, `data/reviews.json`, `data/routes/*.gpx` and sidecars, `public/data/dem/` when present | `public/data/venues.json`, `public/data/routes.json`, `public/data/stats.json` | None; standard library only | After any source-data change |
| `fetch_dem.py` | Download and decode Singapore's AWS Terrarium terrain tiles | AWS Open Data terrain tiles | `public/data/dem/sg-dem.json`, `public/data/dem/sg-dem.bin` | Network; Pillow; no credentials | Once |
| `ingest_hdb.py` | Pull HDB property data and geocode the blocks | data.gov.sg, OneMap, `scripts/.cache/geocode.json` | `data/venues/hdb-blocks.json`, geocode cache | Network; requests, python-dotenv and `ONEMAP_TOKEN` or `ONEMAP_EMAIL` plus `ONEMAP_PASSWORD` in `.env.local` | Roughly annually; about an hour on a cold cache |
| `fetch_peaks.py` | Fetch named OpenStreetMap peaks with an `ele` tag, for one or more regions | Overpass and the existing peaks file unless replacing | `data/venues/peaks.json` | Network; standard library only; no key | When the source region or OSM data changes |
| `import_gpx.py` | Import a route from a file, URL, OSM route relation or your own Strava route, with a provenance sidecar | GPX file/URL, Overpass, Strava API | `data/routes/<slug>.gpx`, `data/routes/<slug>.json` | Network only for URL/OSM/Strava; standard library only; Strava needs `STRAVA_ACCESS_TOKEN` | Per contributed route |
| `fetch_photos.py` | Fetch, resize and record the latest Mapillary image within 60 m of each venue | `public/data/venues.json`, Mapillary, existing `data/photos.json` | `public/photos/*.webp`, `data/photos.json` | Network; Pillow, python-dotenv and `MAPILLARY_TOKEN` in `.env.local` | As imagery is added |
| `scrape_routes_playwright.py` | Scrape a GPX route from dynamic/SPA sites by intercepting network traffic | Site URL, optional saved browser state | `data/routes/<slug>.gpx`, `data/routes/<slug>.json` | Network; Playwright, gpxpy; optional saved login state | Per contributed route |
| `api_route_import.py` | Import a route by calling the platform's backend API with copied headers/cookies/tokens | Site URL/API URL, headers/cookies JSON | `data/routes/<slug>.gpx`, `data/routes/<slug>.json` | Network; httpx, tenacity, gpxpy; user-supplied session | Per contributed route |
| `scrape_trail_photos.py` | Extract trail photos from a detail page and attach the best one to a venue | Trail page URL, venue slug | `public/photos/<name>_<n>.webp`, `data/photos.json` | Network; Playwright, BeautifulSoup4, httpx, Pillow | Per trail with permission |

### Open-licence mountain and trail photos

`fetch_open_photos.py` searches Wikimedia Commons without a key and optionally Flickr. Install the Python script dependencies with `pip install -r scripts/requirements.txt`. Flickr is optional: add `FLICKR_API_KEY=...` to `.env.local` or the environment to enable it. The script only accepts CC BY, CC BY-SA, CC0, and public-domain images; CC BY-NC and CC BY-ND are excluded. Attribution metadata is merged into the ignored `open_trail_media/metadata.json`, while resized WebP derivatives and their attribution are registered for the site.

```bash
# Search one venue and download up to three candidates
python3 scripts/fetch_open_photos.py --venue bukit-timah-hill --limit 3 --overwrite --build

# Search a location without registering it to a venue
python3 scripts/fetch_open_photos.py --lat 1.3546 --lon 103.7764 --radius 1000 --dry-run

# Search the tallest missing hill venues first; download up to three photos per hill
python3 scripts/fetch_open_photos.py --batch --type hill --max-venues 50 --per-venue 3 --build

# Use full-resolution Commons downloads instead of the default 1280px thumbnails
python3 scripts/fetch_open_photos.py --venue bukit-timah-hill --original --dry-run
```

Batch mode fills each venue to `--per-venue` (1–3, default 3) and defaults to venues below that open-photo count; use `--include-existing` to revisit venues or `--overwrite` to replace the existing open gallery. `--max-venues 0` means no limit. Metadata, photo registrations, and `scripts/.cache/open_photos_searched.json` are checkpointed every 25 venues; the search log skips underfilled searches for 30 days unless `--research` is passed. `--dry-run` prints ranked candidates without downloading or writing. Commons name-search fallback is enabled by default when geosearch finds no eligible result; geotagged fallback results must still be within the search radius, and unlocated results with no informative caption are rejected. Pass `--no-name-search` to disable fallback. Obvious signs, boards, markers, plaques, maps, space imagery, numbered image series, botanical/faunal close-ups, and summit/peak Panoramio marker images are filtered out. Candidates must match the venue name/romanised slug or describe a landscape feature; Commons taxonomy, flora/fauna, people, books, scanned images and unrelated-category files are rejected. Open-source attribution is displayed below the photo on venue cards and detail pages. Full metadata (including source, licence, creator, dates, coordinates, and original-download path) is retained in `open_trail_media/metadata.json`; only `public/photos/open/*.webp` derivatives are served by the app. Use `--list-open` to review registered open photos or `--unregister-open <slug> ...` to remove open-photo entries without changing Mapillary records.

For a full rebuild:

```bash
pip install -r scripts/requirements.txt
python3 scripts/fetch_dem.py
python3 scripts/ingest_hdb.py
python3 scripts/fetch_peaks.py --region sg-my
python3 scripts/build_data.py
python3 scripts/fetch_photos.py
python3 scripts/build_data.py
```

`fetch_peaks.py --region` takes one or more comma-separated presets — `singapore`, `sg-my`, `id` (Sumatra/Java/Bali/Lombok), `th`, `vn`, `ph`, `tw`, `hk`, `jp`, `kr`, `au`, `nz`, plus the broad `sea`, `japan`, `alps` — or `--bbox south,west,north,east`. Regions are fetched one after another with a 10 s pause, and merged into the existing file by slug/OSM id, so running `--region hk,tw` keeps the SG/MY entries. Each region has its own minimum elevation (e.g. `sg-my` 100 m, `hk` 150 m, `tw` 2,500 m, `jp` 2,000 m) so mountainous countries do not balloon the file; `--min-ele` overrides it for the whole run and `--max-per-region N` keeps only the tallest N. The script warns when `peaks.json` passes 2 MB — every summit lands in the `venues.json` the browser loads. `--replace` discards rather than merges the existing file. `fetch_photos.py --limit N` caps a run; `--all` re-checks venues that already have a record.

On python.org macOS builds without "Install Certificates.command", HTTPS fails with `CERTIFICATE_VERIFY_FAILED`; `fetch_peaks.py` and `import_gpx.py` then fall back to `certifi` if installed or to `/etc/ssl/cert.pem`, keeping verification on.

### Ratings

`data/reviews.json` holds `{"reviews": [{"venue": "<slug>", "rating": 1-5, "comment": "...", "author": "@handle", "date": "YYYY-MM-DD"}]}`, copied from "Rate a venue" issues. `build_data.py` averages them into each venue as `"rating": {"average": 4.33, "count": 3}` and omits the key for unrated venues. Unknown slugs and out-of-range ratings are skipped with a warning.

### Importing routes

```bash
python3 scripts/import_gpx.py ~/Downloads/run.gpx --name "Kent Ridge repeats" --contributor @you --licence "CC BY 4.0"
python3 scripts/import_gpx.py https://example.org/route.gpx --licence CC0
python3 scripts/import_gpx.py --osm-relation 5993965          # Southern Ridges Walk
python3 scripts/import_gpx.py --strava-route 1234567890       # your own route, official API
python3 scripts/build_data.py
```

The GPX must hold at least two `<trkpt>` or `<rtept>` points; route-only files are converted to a track. `--osm-relation` stitches the relation's ways by nearest endpoints (check the result; branching relations report gaps) and records licence `ODbL © OpenStreetMap contributors` and the relation URL. `--strava-route` calls only `GET /api/v3/routes/{id}/export_gpx` with `STRAVA_ACCESS_TOKEN` from the environment or `.env.local`; it works for routes your token can access and never scrapes strava.com, which Strava's terms forbid. `--dry-run` validates without writing; `--force` overwrites an existing slug. Route sidecars may carry `sourceUrl` and `licence`, which `build_data.py` passes into `routes.json`, and every route gets a coarse `country` from its start point.

### Scraping routes from dynamic sites

`scrape_routes_playwright.py` launches a stealth Chromium browser, loads a saved session if you provide one, then listens to background network traffic and converts intercepted coordinate payloads into GPX.

```bash
pip install -r scripts/requirements.txt
python3 -m playwright install chromium

# For sites that do not require login, or for public API endpoints:
python3 scripts/scrape_routes_playwright.py "https://www.komoot.com/tour/12345678" \
    --name "Komoot tour" --licence "Permission from author" --contributor @you --build

# For sites that require authentication, open the browser, log in manually, save state:
python3 scripts/scrape_routes_playwright.py "https://www.alltrails.com/trail/..." \
    --name "AllTrails route" --no-headless --save-state --state alltrails-state.json

# Then reuse the saved state for future runs:
python3 scripts/scrape_routes_playwright.py "https://www.alltrails.com/trail/..." \
    --name "AllTrails route" --state alltrails-state.json --build
```

**Important:** only scrape routes you have permission to republish. The script prefers official APIs (e.g. Strava with `STRAVA_ACCESS_TOKEN`) where possible. It does not bypass Cloudflare or CAPTCHAs; for authenticated sites you generally need to log in once with `--no-headless --save-state` and reuse that state.

### Importing routes via backend APIs

`api_route_import.py` calls the platform's own REST/GraphQL endpoints using session headers you copy from your browser. It is more reliable than HTML scraping because the response shape is stable.

```bash
# 1. Open the route/activity page, press F12 → Network, reload, find the API call.
# 2. Right-click the request → Copy → Copy as cURL. Save the headers you need:
cat > headers.json <<'EOF'
{
  "Authorization": "Bearer abc123",
  "User-Agent": "Mozilla/5.0 ..."
}
EOF

# Strava route — uses official export_gpx endpoint if Bearer is present
python3 scripts/api_route_import.py "https://www.strava.com/routes/12345678" \
    --name "My Strava route" --headers headers.json --contributor @you --licence "Permission" --build

# Strava activity streams (if you only have an activity URL)
python3 scripts/api_route_import.py "https://www.strava.com/activities/12345678" \
    --name "Morning run" --headers headers.json --contributor @you --build

# Generic JSON API — tell the script where the coordinates live
python3 scripts/api_route_import.py "https://example.com/api/route/123" \
    --name "Example route" --headers headers.json --json-path data.trackPoints --build
```

The script retries failed requests with exponential backoff (`tenacity`), writes the GPX + sidecar, and optionally runs `build_data.py`. It also checks existing `data/routes/*.gpx` and `public/data/routes.json` for duplicates and skips identical tracks unless you pass `--force`.

### Scraping trail photos

`scrape_trail_photos.py` opens a stealth Chromium browser on a trail detail page, scrolls through galleries, listens for photo JSON, extracts `src`/`data-src`/`srcset` URLs with BeautifulSoup4, downloads the highest-resolution candidates with `httpx`, resizes them to the site's 420 px WebP format, and registers the best one against a venue slug.

```bash
# Public page without login
python3 scripts/scrape_trail_photos.py "https://www.alltrails.com/trail/..." \
    --venue mount-faber-singapore --name "Mount Faber" --max 5 --credit "Photographer name" --build

# Authenticated page: log in once, save state, then reuse it
python3 scripts/scrape_trail_photos.py "https://www.wikiloc.com/trail-..." \
    --venue my-hill --name "My Hill" --no-headless --save-state --state trail-state.json

python3 scripts/scrape_trail_photos.py "https://www.wikiloc.com/trail-..." \
    --venue my-hill --name "My Hill" --state trail-state.json --build
```

`--venue` must be an existing HillGPX venue slug so `build_data.py` knows which card/detail page to show the photo on. `--max N` downloads the best N images but only registers one; extras are kept in `public/photos/` for manual use.

Keep `GAIN_THRESHOLD_M` and `SMOOTH_WINDOW` in `build_data.py` in sync with the `computeGain` defaults in `src/lib/elevation.ts`.

`scripts/.cache/` is gitignored. Keep reusable network results there rather than committing caches.
