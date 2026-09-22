# HillGPX

Find elevation gain to train on. A map of hills, staircases and tall blocks in Singapore, with runnable routes and a client-side GPX profiler that never uploads your track.

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

- `data/venues/hills.json` — curated hills, stairs, parks
- `data/venues/hdb-blocks.json` — generated HDB blocks
- `data/venues/peaks.json` — generated OSM summits
- `data/routes/*.gpx` — route tracks
- `public/data/venues.json` and `public/data/routes.json` — generated app datasets

Run `python scripts/build_data.py` after changing any of the source files.

## Known limitations

- The bundled terrain model covers Singapore only. Routes in Malaysia keep the GPX altitudes.
- The DEM is derived from SRTM, so forested summits read higher than ground truth.
- Eight curated Singapore venues still lack verified heights and are invisible until someone measures them. See `CONTRIBUTING.md`.
- `data/routes/` is the biggest content gap; the pipeline exists but the folder is still sparse.

## Agent guidance

- Read `AGENTS.md` before starting work.
- Use Mobbin only as a UX/flow reference within the existing design system: `.devin/skills/mobbin/SKILL.md`.
- For end-to-end workflow testing, use `.devin/skills/hillgpx-workflow/SKILL.md`.

## License

Code is MIT. Contributed GPX files are published under the same terms — only upload files that are yours to share. Data attributions are listed in `CONTRIBUTING.md`.
