# Contributing

Most of what this project needs isn't code. It's local knowledge — which staircases are open, how much a hill actually climbs, where the good repeat venues are. If you train vertical in Singapore, you already know things this map doesn't.

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

`scripts/fetch_dem.py` and `scripts/fetch_photos.py` need Pillow. Only `scripts/ingest_hdb.py` and `scripts/fetch_photos.py` need `.env.local`: copy `.env.example`, then add OneMap credentials or a Mapillary token as appropriate. See [`scripts/README.md`](scripts/README.md) before regenerating data.

---

## Add a route

The one that helps most.

1. Get a GPX. Export from your watch, Strava, or draw one anywhere that exports GPX.
2. Drop it into `data/routes/` with a descriptive kebab-case filename:
   `bukit-timah-summit-loop.gpx`, `marang-trail-repeats.gpx`
3. Rebuild and commit:

```bash
python scripts/build_data.py
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

Nearly every entry in `data/venues/hills.json` is marked `"elevationSource": "estimated"`, which means it's a seed value I wrote down and you should not trust. Several are `null`.

Two numbers matter, and they're different:

- **`summitM`** — height above sea level at the top.
- **`gainM`** — what you actually climb from the normal starting point. This is the one people train by, and it's usually much smaller. Bukit Timah's summit is around 163 m, but nobody starts at sea level.

A venue with both numbers `null` is dropped at build time and does not appear. Mount Faber, Marang Trail, Telok Blangah Hill Park, Kent Ridge Park, Bukit Gombak, Fort Canning Hill, Pearl's Hill City Park and Mount Emily Park are all invisible today. Verifying either number puts one on the map.

**Note:** until this is fixed in `build_data.py`, a curated entry with no height can also hide the OSM record for the same hill — Mount Faber is the current example.

To fix a curated venue:

1. Find a real source, or measure it — a barometric watch on a still day, averaged over a few ascents, is good enough.
2. Update the value, set `"elevationSource"` to `"verified"`, and say where the number came from in `notes`.
3. `python scripts/build_data.py`, then commit.

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

Photos are not added to the repository by hand. Upload useful street-level imagery to [Mapillary](https://www.mapillary.com/), or put a Mapillary token in `.env.local` and run `python scripts/fetch_photos.py`. The script downloads and resizes the latest nearby image, and records its creator and image ID in `data/photos.json`; run `python scripts/build_data.py` afterwards to attach it to the venue.

Mapillary imagery is CC-BY-SA 4.0. Keep the creator credit and image ID intact — the app displays that attribution with every photo.

---

## Code

Normal stuff: fork, branch, PR. `npm run typecheck` and `npm run build` are the CI gates. There's no linter or test framework yet; match the surrounding style.

A few things worth preserving, because they're the point of the project rather than incidental:

- **No backend.** The app is static files. If a feature seems to need a server, say so in an issue first — there's usually a way to keep it static, and the zero-setup clone is what makes this contributable.
- **No API keys.** A fresh clone must run with no accounts and no config.
- **Dropped GPX files never leave the browser.** People upload their training history here. It stays in their tab — or, if they choose to save it, in their own browser's `localStorage`.
- **Never trust GPX altitude.** Re-sample against the terrain model wherever it has coverage. If you change `GAIN_THRESHOLD_M` or `SMOOTH_WINDOW` in `scripts/build_data.py`, change the defaults in `src/lib/elevation.ts` too — otherwise the app and the baked route data will quietly disagree.
- **Never present `summitM` as a climb.** Go through `venueHeight()` for display and use `rankingHeight()` only for sorting.
- **Build URLs from `import.meta.env.BASE_URL`.** Follow `DATA_BASE`; root-absolute paths break the GitHub Pages build under `/HillGPX/`.
- **Map pins are HTML markers, not symbol layers.** `src/map/markers.ts` renders them as DOM elements so they share the app's font and CSS. If you ever add a MapLibre `symbol` layer, use exactly one font in `text-font`: a fallback list makes OpenFreeMap request a glyph stack that 404s, and labels silently disappear.

## Reporting things

Issues are fine for anything: a wrong height, a staircase that's been closed, a route that's mislinked, a bug. Local knowledge is the scarce resource here — if you know something the map gets wrong, that's worth an issue even if you don't want to open a PR.
