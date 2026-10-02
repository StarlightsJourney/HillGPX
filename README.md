# HillGPX

A free, open-source, community-built map of every hill, mountain, staircase and tall block worth climbing — and an open archive of the GPX routes up them, with honest elevation for every file.

HillGPX is not a finished product handed down to users. It is a shared map that runners, hikers and stair climbers build together: every place, photo, rating and route on it was added by someone who trains there. If you know a climb that is missing, the map is waiting for you.

## Why this exists

Good vertical training spots are local knowledge. The stairwell that goes to the 40th floor, the ridge loop that gives 500 m before work, the hill the running club repeats on Thursdays — these live in group chats and people's heads. HillGPX puts that knowledge on one open map so anyone, anywhere, can find their next climb.

## Principles

- **Free for everyone, forever.** The code is MIT-licensed, the site is static files on GitHub Pages, and community contributions live in an open Supabase database anyone can read. No accounts, no paywall, no tracking.
- **Community first.** The map grows through contributions — places, routes, photos, ratings and corrections — not through a company deciding what matters. Contributors are credited on the things they add.
- **Honest numbers.** Hills and mountains show their *elevation*; stairwells and blocks show *EG* (elevation gain, bottom to top); routes show *EG* and *EL* (elevation loss). Every route says where its numbers came from — the recording device, or terrain data when the file had none — and when it was recorded.
- **Phone first.** Most people open HillGPX on a phone at the bottom of a hill. Every screen is designed for a small touch screen first and scaled up to desktop second.
- **Open data, clearly attributed.** Every record keeps the licence and source it came with.

## What you can do today

- Browse **917,000+ hills and mountains in 232 countries** (OpenStreetMap + GeoNames), plus Singapore's stairwells and tall HDB blocks, on a phone-first map. Switch between a flat map and 3D mountain terrain.
- See the community's progress on every page in the milestone bar under the header: plain facts, one at a time ("924,255 hills on the map. 3 have a GPX."), and a drop-down with the full ladder, from *First tracks* at 10 routes to *Every hill* at 5,000. *Add a GPX* sits at the top right of every header. On the home page, search sits in the header, a banner scrolls through every country, and country rows load four at a time as you scroll, with real Wikimedia photos of the highest peaks.
- Every route is tagged **Road run**, **Trail** or **Cycling** (from moving speed and climbing per km, editable on upload); filter by it in the category bar, and see it on cards and as the coloured badge (runner, mountain, bike) on route pins. Minimum EG and distance are in *Filters*.
- Open a route for its trace over real terrain, EG/EL profile, the places it passes (tap one to see it on the map) and other routes it shares ground with. Recording date and where the elevation came from sit behind the (i).
- Venue pages: swipeable photo carousel with a full-screen viewer, live summit conditions (temperature adjusted for altitude, rain chance, sunrise/sunset), directions, Wikipedia context and Airbnb-style reviews.
- **Upload a GPX** with no account — files up to 60 MB (a 200 km ultra or a multi-day trek). It is checked for duplicates, keeps the elevation your device recorded (terrain data only fills in when the file has none), is classified, gets a terrain card image, and is published for everyone under CC BY 4.0. Heart-rate, cadence and other device data are stripped before the file is stored.
- Pin **photos and hazards along a route** (landslips, fallen trees, water points). You see yours on the map straight away; everyone else does once a volunteer approves it. No account needed.
- **Report an issue** with any place or route (wrong details, hazard, closure, bad photo).
- Rate and review places, add photos, heart places (the *Saved* chip in the category bar shows them anywhere in the world), download any route.

## Why there is a GPX size limit (60 MB)

The limit protects the people using the site, not the archive:

- **Phones parse the file in the browser.** A 60 MB GPX is roughly 500,000 points; parsing and simplifying it takes a few seconds and a few hundred MB of memory on a phone. Much larger files can crash a mobile tab.
- **Storage is free but finite.** Supabase's free plan caps uploads at 50 MB per file and 1 GB in total. Files are stripped of heart-rate and other device data and gzipped first (a 50 MB watch export becomes a few MB), and the map only keeps a 4,000-point simplified track, so a 200 km ultra or a multi-day trek fits comfortably.
- **Abuse.** A cap stops anyone filling the free storage with junk.

If a file is too big, export it from your watch app without heart-rate/power data, or as a course/route rather than an activity.

## How descriptions are written

`scripts/describe_venues.py` writes every "About this place" text in one fixed format: **two short sentences, 10 to 30 words, very simple words**. Sentence one says what the place is and names anything iconic (the highest point, a famous tower or temple). Sentence two gives one useful fact for going there. No em dashes, semicolons or marketing words; the script rejects and retries anything that breaks the format, so future descriptions match. On the page the text shows three lines with a *Read more* link when it is longer.

The landing's highest summits in every country are described too: `python3 scripts/describe_venues.py --world --facts-ok --limit 1400` (the Groq free tier allows roughly 1,000 requests a day, so a full run may take two days; it resumes and skips places whose inputs have not changed).

## How route difficulty is worked out

Unless a route's sidecar sets `difficulty`, it is computed in `routeDifficulty()` (`src/lib/routes.ts`) from two numbers:

- **Effort score** = distance in km + EG in metres ÷ 100 (so 100 m of climbing counts like 1 km of running — the Naismith-style rule of thumb).
- **Climb rate** = EG per km.

| Label | Effort score | or climb rate |
|---|---|---|
| Brutal | > 60 | > 80 m/km |
| Hard | > 25 | > 40 m/km |
| Moderate | > 10 | > 15 m/km |
| Easy | otherwise | |

Example: Kluang trail run, 14.2 km with 1,501 m EG → score 29.2 and 106 m/km → *Brutal* (by climb rate). Southern Ridges, 10.7 km and 254 m → score 13.3, 24 m/km → *Moderate*.

## An open GPX archive

The long-term aim is for HillGPX to be to climbing routes what community subtitle archives such as Jimaku are to subtitles: one open, searchable place where anyone can find, download and contribute route files, organised around the hills and mountains they climb. Every route has its original file, licence and credit; duplicates are refused and overlapping routes are linked; and the whole archive is exportable so it can be mirrored and built on. See [docs/COMMUNITY.md](docs/COMMUNITY.md#8-roadmap-toward-a-gpx-archive).

## How to contribute

You do not need to write code to help.

- **Upload a GPX** — *Add a GPX* on the map or any venue page. No account; published immediately under CC BY 4.0 with your credit.
- **Rate and review** a place from its page — the practical details (gates, water, shade, best time) help most.
- **Add photos** from a venue page, even if it already has some. Photos appear after a quick volunteer check.
- **Add a missing place** — *Add a place* in the menu (GitHub issue form).
- **Correct an elevation** — see [Verify a venue's elevation](CONTRIBUTING.md#verify-a-venues-elevation).
- **Improve the app** — issues and pull requests are welcome; start with the development setup below.

How the project is governed, moderated, kept running and funded is in **[docs/COMMUNITY.md](docs/COMMUNITY.md)**.

## Where this could go

The core map stays free and community-owned. Ideas we are open to exploring with the community over time, none of which are built yet:

- **Cycling routes** alongside running and hiking routes.
- **Trail events** — races and group runs shown on the map where they happen.
- **Accounts (optional)** — sign in to sync hearted places across devices and build a contributor profile. Hearts stay on your device until then.
- **Automatic photo screening** — a safety model pre-checks uploads so volunteers only review edge cases.
- **Partners** — trail-running shops and brands showcasing gear, and clearly labelled sponsored places or posts, as a way to cover hosting and data costs.
- **Wider coverage** — more routes and photos everywhere, regional stewards, and a volunteer-maintained open GPX and photo dataset.

Anything sponsored will always be labelled as such, and will never change the numbers, rankings or the free core of the map. The full plan — donations, grants, event listings, partner showcases — and the principles that constrain it are in [docs/COMMUNITY.md](docs/COMMUNITY.md#7-paying-for-it-without-selling-out). If you have views on how this should work, open an issue — this direction is decided in the open.

## Stack

- Vite + React + TypeScript
- MapLibre GL with free, keyless [OpenFreeMap](https://openfreemap.org) tiles and [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) for hillshade, 3D terrain and missing GPX elevation
- [Supabase](https://supabase.com) (Postgres + Storage) for community routes, photos and reviews — schema and row-level security in `supabase/migrations/`
- Python 3 data pipeline (`scripts/`)
- GitHub Pages for deployment

The browser uses Supabase's *publishable* key, which is designed to be public: row-level security only allows inserting new rows and reading approved ones. A fork can point at its own project with `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`.

## Development setup

```bash
git clone https://github.com/StarlightsJourney/HillGPX.git
cd HillGPX
npm install
npm run dev
```

The app opens at [http://localhost:5180](http://localhost:5180). Port 5180 is strict; stop anything already using it.

## Validation commands

Run these before any handoff:

```bash
npm run typecheck
npm run build
python3 scripts/build_data.py
```

After adding or changing a route, also render its card image (a stored basemap with hillshade, so phones never render a map per card):

```bash
node scripts/render_route_thumbs.ts          # only new or changed routes
node scripts/render_route_thumbs.ts --force  # everything
```

**Groq key for AI descriptions:** paste it into `.env.local` (already created, git-ignored) as `GROQ_API_KEY=…`, then run `python3 scripts/describe_venues.py --limit 50`. Free Groq keys can expire; when it does, replace the value and re-run. Never commit the key or put it in `src/`.

Other data jobs:

```bash
python3 scripts/fetch_world_peaks.py         # worldwide summits from GeoNames → public/data/peaks/ (5° tiles)
python3 scripts/fill_route_elevation.py      # give committed GPX files without <ele> terrain elevation
python3 scripts/describe_venues.py --limit 50  # AI "About this place" text (needs GROQ_API_KEY or FREELLMAPI_* in .env.local)
python3 scripts/fetch_peak_photos.py           # Wikimedia photos for the landing's highest peaks → public/data/peaks/photos.json (links only)
```

## Quick vertical-slice workflow test

1. Add or edit a venue in `data/venues/hills.json` with a real `gainM` or `summitM`.
2. Drop a `.gpx` into `data/routes/`.
3. Run `python3 scripts/build_data.py`, then `node scripts/render_route_thumbs.ts`.
4. Run `npm run dev` and open `/#map`.
5. Search for the venue or route, open its detail card, and verify it renders with height/distance/gain.
6. Click **Download GPX** and confirm the file round-trips.

For fixture-driven testing, see `.devin/skills/hillgpx-workflow/SKILL.md`.

## Data model

- `data/venues/hills.json` — curated hills and mountains
- `data/venues/peaks.json` — generated worldwide OSM summits
- `data/venues/hdb-blocks.json` — Singapore HDB training data
- `data/routes/*.gpx` — route tracks with optional provenance sidecars
- `data/photos.json` — photo attribution and source metadata
- `public/data/venues.json` and `public/data/routes.json` — generated app datasets
- `public/route-thumbs/*.jpg` — generated route card basemaps
- `public/data/peaks/` — worldwide summit tiles (`index.json` + `<south>_<west>.json`), loaded by the map only for what is on screen
- `public/data/descriptions.json` — generated venue descriptions (Wikipedia + reviews, via an LLM)
- Supabase tables `routes`, `photos`, `reviews` and buckets `gpx`, `photos` — community contributions (`supabase/migrations/`)

Run `python3 scripts/build_data.py` after changing any of the source files.

## Data sources and licensing

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, served by [OpenFreeMap](https://openfreemap.org) (OpenMapTiles schema).
- Worldwide summits from [GeoNames](https://www.geonames.org) (CC BY 4.0) and OpenStreetMap (ODbL).
- Venue summaries from [Wikipedia](https://en.wikipedia.org) (CC BY-SA), linked on each page; fallback photos from Wikimedia Commons, credited per photo.
- Community routes CC BY 4.0; community photos CC BY-SA 4.0 / CC BY 4.0 / CC0 as chosen by the contributor; reviews CC BY 4.0.
- Weather on venue pages from [Open-Meteo](https://open-meteo.com) (CC BY 4.0, free for non-commercial use).
- Terrain and hillshade from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (SRTM and other public sources).
- HDB data from [data.gov.sg](https://data.gov.sg); geocoding via OneMap.
- Photos from [Mapillary](https://www.mapillary.com) and [Wikimedia Commons](https://commons.wikimedia.org), each shown with its own attribution.
- Routes keep the contributor, source URL and licence recorded in their sidecar.

## Known limitations

- The bundled terrain model covers Singapore only. Elsewhere, routes use device elevation when the file has it and AWS Terrain Tiles (~38 m resolution) when it does not, which smooths short, steep pitches.
- GeoNames summits without a surveyed height use SRTM elevation, which can be tens of metres off on sharp peaks.
- Mapillary photos are stored at card size only (originals need `MAPILLARY_TOKEN` to refresh); Commons photos are shown sharp from Wikimedia.
- The DEM is derived from SRTM, so forested summits can read higher than ground truth.
- Coverage is uneven and routes remain the largest content gap — which is exactly where contributions help most.

## Agent guidance

- Read `AGENTS.md` before starting work.
- Use Mobbin only as a UX/flow reference within the existing design system: `.devin/skills/mobbin/SKILL.md`.
- For end-to-end workflow testing, use `.devin/skills/hillgpx-workflow/SKILL.md`.

## License

Code is MIT. Venue, GPX, and photo records retain the licence and attribution of their original source; only contribute material that permits redistribution. Data attributions and contribution rules are listed in `CONTRIBUTING.md`.
