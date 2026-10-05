# Developing HillGPX

The technical reference for people (and agents) working in the repository:
setup, the data files and their formats, and the rules the code relies on.

New here and not a developer? Start with [CONTRIBUTING.md](../CONTRIBUTING.md)
instead. Most help this project needs is data, and none of it needs git.

## Setup

```bash
npm install
npm run dev
```

The browser opens at [http://localhost:5180](http://localhost:5180). Port 5180 is strict, so stop whatever is using it rather than expecting Vite to choose another one.

The web app needs no database, keys or `.env` file. If that isn't true for you, it's a bug — please open an issue. `scripts/build_data.py` also needs nothing beyond the Python standard library.

For the other data scripts, install their dependencies:

```bash
pip install -r scripts/requirements.txt
```

`scripts/fetch_dem.py` and `scripts/fetch_photos.py` need Pillow. Only `scripts/ingest_hdb.py` and `scripts/fetch_photos.py` need `.env.local`: copy `.env.example`, then add OneMap credentials or a Mapillary token as appropriate. See [`scripts/README.md`](../scripts/README.md) before regenerating data.

---

## Add a route

The one that helps most.

1. Get a GPX. Export from your watch, Strava, or draw one anywhere that exports GPX.
2. Drop it into `data/routes/` with a descriptive kebab-case filename:
   `bukit-timah-summit-loop.gpx`, `marang-trail-repeats.gpx`
3. Rebuild and commit:

```bash
python3 scripts/build_data.py
git add data/routes/ public/data/
git commit -m "Add Bukit Timah summit loop"
```

Or let the importer name, validate and write the sidecar for you:

```bash
python3 scripts/import_gpx.py ~/Downloads/run.gpx --name "Bukit Timah summit loop" --contributor @you --licence "CC BY 4.0"
python3 scripts/import_gpx.py --osm-relation 5993965   # an OpenStreetMap hiking relation (ODbL)
```

It also accepts a GPX URL and, via the official Strava API with your own `STRAVA_ACCESS_TOKEN`, your own Strava routes (`--strava-route ID`). It never scrapes Strava. Not comfortable with git? Use the **Add a route** issue form and attach the GPX.

The build script works out the distance, the gain, whether it's a loop, and which venues it passes. You don't need to supply any of that.

**Optional sidecar.** If you want to add detail or override the automatic venue linking, put a `.json` next to the GPX with the same basename:

```json
{
  "name": "Bukit Timah summit loop",
  "description": "Steepest line up from Hindhede. Concrete the whole way, brutal in the afternoon.",
  "surface": "road",
  "difficulty": "hard",
  "venues": ["bukit-timah-hill", "hindhede-nature-park"],
  "contributor": "@your-github-handle",
  "licence": "CC BY 4.0",
  "sourceUrl": "https://example.org/where-it-came-from"
}
```

**Only upload GPX files that are yours.** Don't re-upload someone else's Strava activity. And check the track doesn't start at your front door — trim the first and last few hundred metres if it does.

---

## Verify a venue's elevation

Nearly every entry in `data/venues/hills.json` is marked `"elevationSource": "estimated"`, which means it's a seed value written down by hand and you should not trust it. Several are `null`.

Two numbers matter, and they're different:

- **`summitM`** — height above sea level at the top.
- **`gainM`** — what you actually climb from the normal starting point. This is the one people train by, and it's usually much smaller. Bukit Timah's summit is around 163 m, but nobody starts at sea level.

A venue with both numbers `null` is dropped at build time and does not appear. Mount Faber, Marang Trail, Telok Blangah Hill Park, Kent Ridge Park, Fort Canning Hill, Pearl's Hill City Park and Mount Emily Park are all invisible today. Verifying either number puts one on the map.

**Note:** until this is fixed in `build_data.py`, a curated entry with no height can also hide the OSM record for the same hill — Mount Faber is the current example.

To fix a curated venue:

1. Find a real source, or measure it — a barometric watch on a still day, averaged over a few ascents, is good enough.
2. Update the value, set `"elevationSource"` to `"verified"`, and say where the number came from in `notes`.
3. `python3 scripts/build_data.py`, then commit.

Cite the source. An unsourced number is the thing we already have.

OpenStreetMap summits live in generated `data/venues/peaks.json`; do not hand-edit it. Correct the `ele` tag in OpenStreetMap and run `python3 scripts/fetch_peaks.py --region sg-my` (regions combine, e.g. `--region sg-my,hk,tw`, and merge without dropping existing entries), or use a bounding box. If you measured the *climb*, add or extend a curated entry in `data/venues/hills.json` with `gainM`; curated entries load first and win the deduplication.

---

## Add a venue

Anywhere public that people actually train on: hills, park staircases, multi-storey carparks, long overhead bridges. Add an entry to `data/venues/hills.json`:

```json
{
  "slug": "some-hill",
  "name": "Some Hill",
  "type": "hill",
  "lat": 1.3456,
  "lng": 103.7890,
  "summitM": null,
  "gainM": null,
  "elevationSource": "estimated",
  "notes": "Access from the north car park. Gate closes at 7pm."
}
```

`type` is one of `hill`, `stairs`, `park`, `carpark`, `bridge`. (`hdb_block` is generated — don't add those by hand.)

Leave a number `null` rather than guessing. A null is an honest gap someone can fill; a wrong number looks authoritative and can sit there for years. This records the venue, but it will not appear in the app until either `gainM` or `summitM` is filled in.

**Access matters.** If it's private, gated, or somewhere you technically shouldn't be, say so in `notes` — or don't add it. This should not become a list of places to trespass.

---

## Rate a venue

Open the **Rate a venue** issue form (the app can link to it prefilled: `https://github.com/StarlightsJourney/HillGPX/issues/new?template=rate-venue.yml&venue=<slug>&rating=5`). A maintainer appends it to `data/reviews.json`:

```json
{"venue": "bukit-timah-hill", "rating": 5, "comment": "Shady, steep, busy after 7am", "author": "@you", "date": "2025-01-31"}
```

`python3 scripts/build_data.py` averages ratings per venue. Ratings with an unknown slug or outside 1–5 are skipped with a warning.

The **Add a place** and **Add a photo** issue forms cover the same ground for people who would rather not edit JSON.

---

## Photos

Photos are not added to the repository by hand. Upload useful street-level imagery to [Mapillary](https://www.mapillary.com/), or put a Mapillary token in `.env.local` and run `python3 scripts/fetch_photos.py`. The script downloads and resizes the latest nearby image, and records its creator and image ID in `data/photos.json`; run `python3 scripts/build_data.py` afterwards to attach it to the venue.

Mapillary imagery is CC-BY-SA 4.0. Keep the creator credit and image ID intact — the app displays that attribution with every photo.

---

## Code

Branch, commit, open a pull request (the team workflow is in [CONTRIBUTING.md](../CONTRIBUTING.md#working-on-the-code-together)). `npm run typecheck` and `npm run build` are the CI gates. Before asking for review, also run `npm run lint`, `npm test` (Vitest) and `npm run test:e2e` (Playwright, against the dev server); match the surrounding style.

`npm install` points git at `.githooks/`, whose `commit-msg` hook strips AI/bot `Co-authored-by:` trailers so tools never appear as contributors on GitHub. Human co-authors are kept.

A few things worth preserving, because they're the point of the project rather than incidental:

- **Static first.** The app is static files on GitHub Pages. The only backend is Supabase for community contributions (routes, photos, reviews, reports), reached through `src/lib/api.ts`. If a feature seems to need more server, open an issue first.
- **No secret keys.** A fresh clone runs with no accounts and no config. The browser only carries Supabase's *publishable* key; row-level security limits it to inserting new rows and reading approved ones.
- **Uploads are opt-in.** A dropped GPX is profiled in the browser and only leaves it when the person presses *Publish*. Heart-rate, cadence and other device data are stripped first.
- **Honest elevation.** Uploaded GPX files keep the elevation the device recorded; terrain data only fills files that have none. Committed routes inside the Singapore terrain model are re-sampled by `scripts/build_data.py`. If you change `GAIN_THRESHOLD_M` or `SMOOTH_WINDOW` there, change the defaults in `src/lib/elevation.ts` too, or the app and the baked route data will quietly disagree.
- **Never present `summitM` as a climb.** Go through `venueHeight()` for display and use `rankingHeight()` only for sorting.
- **Build URLs from `import.meta.env.BASE_URL`.** Follow `DATA_BASE`; root-absolute paths break the GitHub Pages build under `/HillGPX/`.
- **Map pins are HTML markers, not symbol layers.** `src/map/markers.ts` renders them as DOM elements so they share the app's font and CSS. If you ever add a MapLibre `symbol` layer, use exactly one font in `text-font`: a fallback list makes OpenFreeMap request a glyph stack that 404s, and labels silently disappear.

## Checks before a pull request

```bash
npm run typecheck
npm run lint
npm test               # Vitest unit tests
npm run test:e2e       # Playwright, against the dev server
npm run build
python3 scripts/build_data.py
```

After adding or changing a route, render its card image (a stored basemap with hillshade, so phones never draw a map per card):

```bash
node scripts/render_route_thumbs.ts          # only new or changed routes
node scripts/render_route_thumbs.ts --force  # everything
```

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`, which builds with `VITE_BASE=/HillGPX/` (or `/` once `public/CNAME` exists for a custom domain; see the README's "Hosting and a custom domain") and publishes `dist/` to GitHub Pages. To check a production build under the same sub-path:

```bash
VITE_BASE=/HillGPX/ npm run build
npx vite preview --base /HillGPX/
```

MapLibre 6 looks for its web worker next to its own module and Vite does not copy that file, so `src/map/worker.ts` bundles it and registers it with `setWorkerUrl()`. Every module that creates a map imports it first; without it the map is blank on Pages but fine in `npm run dev`.

## Data files

- `data/venues/hills.json`: curated hills and mountains
- `data/venues/peaks.json`: generated OpenStreetMap summits (do not hand-edit)
- `data/venues/hdb-blocks.json`: Singapore HDB blocks
- `data/routes/*.gpx`: committed routes, each with an optional `.json` sidecar
- `data/photos.json`: photo attribution and source
- `public/data/venues.json`, `public/data/routes.json`: generated by `build_data.py`
- `public/data/peaks/`: worldwide GeoNames summits as 5° tiles plus `index.json` (country boxes, landing rows, zoomed-out highlights) and `photos.json` (Commons links)
- `public/data/descriptions.json`: generated "About this place" text
- `public/route-thumbs/*.jpg`: generated route card images
- Supabase tables `routes`, `photos`, `route_photos`, `reviews`, `reports` and their buckets: community contributions (`supabase/migrations/`)

## Data jobs

```bash
python3 scripts/fetch_world_peaks.py           # GeoNames summits -> public/data/peaks/ (keeps photos.json)
python3 scripts/fetch_peak_photos.py           # Commons photos for the landing rows -> public/data/peaks/photos.json (links only)
python3 scripts/fill_route_elevation.py        # terrain elevation for committed GPX files without <ele>
python3 scripts/describe_venues.py --limit 50  # "About this place" text; needs GROQ_API_KEY (or FREELLMAPI_*) in .env.local
```

Free Groq keys can expire; replace the value in `.env.local` and re-run. Never commit a key or put one in `src/`.

### How descriptions are written

`describe_venues.py` writes every description in one format: two short sentences in simple words. The first says what the place is and names anything iconic; the second gives one useful fact for going there. No em dashes, semicolons or marketing words; the script rejects and retries anything that breaks the format. The landing's summits are described with `--world --facts-ok --limit 1400` (the Groq free tier allows about 1,000 requests a day; the script resumes).

### How route difficulty is worked out

Unless a sidecar sets `difficulty`, `routeDifficulty()` in `src/lib/routes.ts` uses an effort score (km + EG metres / 100) and a climb rate (EG per km):

| Label | Effort score | or climb rate |
|---|---|---|
| Brutal | > 60 | > 80 m/km |
| Hard | > 25 | > 40 m/km |
| Moderate | > 10 | > 15 m/km |
| Easy | otherwise | |

## Reporting things

Issues are fine for anything: a wrong height, a staircase that's been closed, a route that's mislinked, a bug. Local knowledge is the scarce resource here — if you know something the map gets wrong, that's worth an issue even if you don't want to open a PR.
