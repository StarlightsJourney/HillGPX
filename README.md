# hillGPX

**Find elevation gain to train on.** A map of every hill, staircase and tall HDB block in Singapore, with the routes that climb them — and a place to drop your own GPX and get an honest elevation profile back.

Built for people who train vertical: towerrunners, trail runners with a race in the mountains and no mountains at home, anyone chasing metres of climbing in a country whose highest natural point is about 163 m.

> **Status: early.** The map, the venue data and the GPX profiler work. Routes are just getting started, and most venue elevations are unverified seed values. See [Contributing](#contributing) — correcting them is the most useful thing you can do right now.

---

## Run it

```bash
git clone https://github.com/StarlightsJourney/HillGPX.git
cd hillGPX
npm install
npm run dev
```

That's it. No database, no API keys, no accounts, no `.env` file. The app is a static site that reads two JSON files, and both are committed to the repo.

Basemap tiles come from [OpenFreeMap](https://openfreemap.org/), which is free and needs no key. Please keep it that way.

## How it works

Everything the app needs is a static file:

```
data/                       what humans edit
├── venues/hills.json       curated hills, stairs and parks
├── venues/hdb-blocks.json  generated — 10,796 HDB blocks
└── routes/*.gpx            one GPX per route, plus an optional .json sidecar
        │
        │  scripts/build_data.py
        ▼
public/data/
├── venues.json             what the app loads
├── routes.json
└── dem/sg-dem.{json,bin}   terrain model for Singapore
```

A route contribution is one GPX file and a pull request. A height correction is a one-line diff. There is no admin panel, no moderation queue and no server — the data *is* the repo, so every change is reviewable and revertable.

### Rebuilding the data

```bash
pip install -r scripts/requirements.txt

python scripts/fetch_dem.py     # terrain model, ~3.5 MB — run once
python scripts/build_data.py    # merge venues + routes -> public/data/
```

`scripts/ingest_hdb.py` regenerates the 10,796 residential HDB blocks from data.gov.sg. It takes about an hour on a cold cache and only needs running when HDB publishes new data — roughly annually — so you almost certainly don't need to.

## Why elevation is re-sampled, not read

The `<ele>` values in a GPX file come from consumer GPS, and they are noisy enough that naively summing the deltas invents hundreds of phantom metres over a long route. So the app ignores them: elevations are re-sampled against a bundled terrain model, then gain is accumulated only across runs that exceed a 2 m threshold.

Singapore is small enough (~50 × 27 km) that the whole country at ~38 m resolution is about 2.8 MB as `int16` metres. That fits in the repo, which is why profiles are computed with no API call, no rate limit and no network — a GPX you drop in is parsed in your tab and never uploaded anywhere.

**Known limitation:** the terrain tiles are derived from SRTM, which is a *surface* model — it measures the top of the tree canopy, not the ground. Over forest it reads high. Bukit Timah's summit samples at 172 m against a true figure nearer 163 m, and the error is larger under dense cover than over open ground. So the profiles are good for comparing routes and tracking gain, but a DEM figure is not a substitute for actually verifying a venue's elevation. This is precisely why `hills.json` wants human-sourced numbers.

## The map

- **Hills, staircases and parks** carry an icon and are visible at every zoom. They're landmarks — you navigate by them.
- **HDB blocks** are dots, and only appear once you've zoomed into a neighbourhood. There are 10,796 of them; shown at every zoom they'd bury everything else.
- Colour is elevation gain, from blue (under 30 m) through to purple (120 m and up). One ramp for hills and blocks alike, so a 40-storey block and a small hill read as the same size of climb — because they are.

## Roadmap

| | |
|---|---|
| **Now** | Map, venues, per-venue routes, GPX drop-in profiler |
| **Next** | Session builder — pick venues and reps, get total vertical, export GPX with waypoints |
| **Later** | Snap-to-path route drawing over the OSM pedestrian network |
| **Later** | "Give me 500 m of gain within 3 km of here" — generate a session against a target |
| **Someday** | Other countries. Nothing in the data model is Singapore-specific except the bundled terrain model and the HDB ingest |

## Contributing

The most valuable contributions right now need no code:

- **Verify a venue's elevation.** Almost every entry in `data/venues/hills.json` is an unverified seed value, and several are missing entirely. Measure or source one, cite it, open a PR.
- **Add a route.** Drop a `.gpx` into `data/routes/`, run `python scripts/build_data.py`, commit both. That's the whole process.
- **Add a venue.** Any public staircase, hill, or multi-storey carpark that people actually train on.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the details.

## Data sources and licensing

- **HDB property data** — [data.gov.sg](https://data.gov.sg), under the Singapore Open Data Licence. Attribution required.
- **Coordinates** — geocoded via [OneMap](https://www.onemap.gov.sg).
- **Terrain** — [AWS Open Data terrain tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium encoding, derived from SRTM and other open sources).
- **Basemap** — [OpenFreeMap](https://openfreemap.org/), data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.

> ⚠️ **Unresolved:** whether OneMap's terms permit redistributing bulk derived geocodes in a public repository. This needs checking before `data/venues/hdb-blocks.json` is published. Until then, treat that file as local-only.

Code is [MIT](LICENSE). Contributed routes are published under the same terms — only upload GPX files that are yours to share.
