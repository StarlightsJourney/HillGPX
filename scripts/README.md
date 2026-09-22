# Data scripts

All generated outputs are committed. The app does not run Python or need these credentials.

| Script | Purpose | Reads | Writes | Network and credentials | How often |
|---|---|---|---|---|---|
| `build_data.py` | Merge venues, photos and routes; simplify and profile routes; build landing statistics | `data/venues/*.json`, `data/photos.json`, `data/routes/*.gpx` and sidecars, `public/data/dem/` when present | `public/data/venues.json`, `public/data/routes.json`, `public/data/stats.json` | None; standard library only | After any source-data change |
| `fetch_dem.py` | Download and decode Singapore's AWS Terrarium terrain tiles | AWS Open Data terrain tiles | `public/data/dem/sg-dem.json`, `public/data/dem/sg-dem.bin` | Network; Pillow; no credentials | Once |
| `ingest_hdb.py` | Pull HDB property data and geocode the blocks | data.gov.sg, OneMap, `scripts/.cache/geocode.json` | `data/venues/hdb-blocks.json`, geocode cache | Network; requests, python-dotenv and `ONEMAP_TOKEN` or `ONEMAP_EMAIL` plus `ONEMAP_PASSWORD` in `.env.local` | Roughly annually; about an hour on a cold cache |
| `fetch_peaks.py` | Fetch named OpenStreetMap peaks with an `ele` tag | Overpass and the existing peaks file unless replacing | `data/venues/peaks.json` | Network; standard library only; no key | When the source region or OSM data changes |
| `fetch_photos.py` | Fetch, resize and record the latest Mapillary image within 60 m of each venue | `public/data/venues.json`, Mapillary, existing `data/photos.json` | `public/photos/*.webp`, `data/photos.json` | Network; Pillow, python-dotenv and `MAPILLARY_TOKEN` in `.env.local` | As imagery is added |

For a full rebuild:

```bash
pip install -r scripts/requirements.txt
python scripts/fetch_dem.py
python scripts/ingest_hdb.py
python scripts/fetch_peaks.py --region sg-my
python scripts/build_data.py
python scripts/fetch_photos.py
python scripts/build_data.py
```

`fetch_peaks.py` accepts `--region singapore|sg-my|sea|alps|japan|nz` or `--bbox south,west,north,east`; `--min-ele` defaults to 50 m, and `--replace` discards rather than merges the existing file. `fetch_photos.py --limit N` caps a run; `--all` re-checks venues that already have a record.

Keep `GAIN_THRESHOLD_M` and `SMOOTH_WINDOW` in `build_data.py` in sync with the `computeGain` defaults in `src/lib/elevation.ts`.

`scripts/.cache/` is gitignored. Keep reusable network results there rather than committing caches.
