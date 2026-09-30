# HillGPX

Discover hills, mountains, and summits worldwide, inspect their routes and elevation profiles, and download or privately analyse GPX tracks. HillGPX prioritizes accurate mountain locations, useful route coverage, and clear source attribution.

## Product scope

HillGPX is primarily a worldwide hill and mountain discovery product. Current Singapore HDB and stair-training data remains available, but expanding generic parks, carparks, bridges, and unrelated venue categories is not a project priority.

The next data expansion will integrate the volunteer-maintained open-source GPX and photo dataset selected for the project. Once its repository or API is available, imports must preserve source, contributor, licence, and attribution metadata; the existing public OSM and contributed-GPX workflows remain valid in the meantime.

## Stack

- Vite 5 + React 18 + TypeScript 5
- MapLibre GL for the map
- Python 3 data pipeline (`scripts/build_data.py`)
- GitHub Pages for deployment

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
python scripts/build_data.py
```

## Quick vertical-slice workflow test

1. Add or edit a venue in `data/venues/hills.json` with a real `gainM` or `summitM`.
2. Drop a `.gpx` into `data/routes/`.
3. Run `python scripts/build_data.py`.
4. Run `npm run dev` and open `/#map`.
5. Search for the venue or route, open its detail card, and verify it renders with height/distance/gain.
6. Click **Download GPX** and confirm the file round-trips.

For fixture-driven testing, see `.devin/skills/hillgpx-workflow/SKILL.md`.

## Data model

- `data/venues/hills.json` — curated hills and mountains
- `data/venues/peaks.json` — generated worldwide OSM summits
- `data/venues/hdb-blocks.json` — existing Singapore HDB training data
- `data/routes/*.gpx` — route tracks with optional provenance sidecars
- `data/photos.json` — photo attribution and source metadata
- `public/data/venues.json` and `public/data/routes.json` — generated app datasets

Run `python scripts/build_data.py` after changing any of the source files.

## Known limitations

- The bundled terrain model covers Singapore only. Routes elsewhere use trustworthy GPX elevation when present and otherwise report elevation as unavailable.
- The DEM is derived from SRTM, so forested summits can read higher than ground truth.
- Worldwide coverage is uneven and route coverage remains the largest content gap.
- The volunteer GPX/photo source is not integrated until its repository, API, or export format is supplied and its licence can be recorded.

## Agent guidance

- Read `AGENTS.md` before starting work.
- Use Mobbin only as a UX/flow reference within the existing design system: `.devin/skills/mobbin/SKILL.md`.
- For end-to-end workflow testing, use `.devin/skills/hillgpx-workflow/SKILL.md`.

## License

Code is MIT. Venue, GPX, and photo records retain the licence and attribution of their original source; only contribute material that permits redistribution. Data attributions and contribution rules are listed in `CONTRIBUTING.md`.
