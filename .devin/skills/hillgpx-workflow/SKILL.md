---
name: hillgpx-workflow
description: Run an end-to-end vertical-slice workflow test after changes to routes, venues, GPX profiling, map rendering, or the data pipeline
triggers:
  - user
  - after changes to data/routes/, data/venues/, src/components/Gpx*, src/map/, src/lib/routes.ts, src/lib/elevation.ts, src/lib/gpx.ts, scripts/build_data.py
allowed-tools:
  - read
  - grep
  - edit
  - exec
  - browser_preview
permissions:
  allow:
    - Read(data/**)
    - Read(public/data/**)
    - Read(src/**)
    - Read(scripts/**)
    - Write(data/**)
    - Write(public/data/**)
    - Write(src/**)
---

# HillGPX vertical-slice workflow skill

Use this after any change to routes, venues, the GPX profiler, map rendering, or the data pipeline. The goal is to verify a complete user path with real data, not just that the typechecker passes.

## When to use

- Adding or editing a venue in `data/venues/`.
- Adding a `.gpx` to `data/routes/`.
- Changing `scripts/build_data.py`, `src/lib/elevation.ts`, `src/lib/gpx.ts`, `src/lib/routes.ts`, or `src/lib/venues.ts`.
- Changing map rendering, search, filters, venue cards, venue detail, or the GPX dropzone.
- Changing units, localStorage persistence, or route saving.

## Prerequisites

- Node.js 20+ (`node --version`)
- npm (`npm --version`)
- Python 3 (`python --version` or `python3 --version`)
- Optionally a browser to visually inspect `http://localhost:5180`

## Fixture generation

The project’s own data files serve as fixtures. For a quick smoke test without touching real data:

1. Create a scratch copy:

   ```bash
   mkdir -p /tmp/hillgpx-fixtures
   cp data/venues/hills.json /tmp/hillgpx-fixtures/hills.json
   ```

2. Add a synthetic venue or keep an existing one with a known good height.

3. If you need a test GPX, copy a real one from `data/routes/` or generate one with the fallback script below.

### Shell fallback for a minimal test GPX

```bash
mkdir -p /tmp/hillgpx-fixtures
cat > /tmp/hillgpx-fixtures/test-loop.gpx <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1">
  <trk>
    <name>Test loop</name>
    <trkseg>
      <trkpt lat="1.3542" lon="103.7765"><ele>40</ele></trkpt>
      <trkpt lat="1.3543" lon="103.7766"><ele>50</ele></trkpt>
      <trkpt lat="1.3544" lon="103.7765"><ele>60</ele></trkpt>
      <trkpt lat="1.3543" lon="103.7764"><ele>50</ele></trkpt>
      <trkpt lat="1.3542" lon="103.7765"><ele>40</ele></trkpt>
    </trkseg>
  </trk>
</gpx>
EOF
```

Do not commit generated fixtures or scratch GPX files.

## Numbered workflow

1. **Reset data to a known state.**

   ```bash
   git status data/ public/data/
   ```

   Only add or modify source files under `data/` and `src/`. Generated files under `public/data/` are rebuilt in step 3.

2. **Rebuild datasets.**

   ```bash
   python scripts/build_data.py
   ```

   Confirm `public/data/venues.json` and `public/data/routes.json` are updated and no Python exceptions are raised.

3. **Validate frontend build.**

   ```bash
   npm run typecheck
   npm run build
   ```

4. **Start the dev server.**

   ```bash
   npm run dev
   ```

   If port 5180 is occupied, stop the other process first. Do not silently change the port in `vite.config.ts` without noting it.

5. **Open the landing page.**

   - Verify the counts from `public/data/stats.json` render.
   - Verify the west-to-east terrain transect renders without console errors.

6. **Open the map.**

   - Navigate to `/#map`.
   - Verify map tiles load.
   - Verify venue pills appear and the tallest venue in each viewport cell is visible.
   - Hover a pill and confirm it grows; click it and confirm a compact card opens.

7. **Search.**

   - Type a known venue name, e.g. `Bukit Timah` or a town name such as `payoh`.
   - Confirm results update and are clickable.

8. **Open a venue detail page.**

   - Click a card or map pill to reach `/#venue/<slug>`.
   - Verify height, notes, mini map, nearby venues, and route cards render.
   - If the venue has routes, click **Show on map** and confirm the route line appears.

9. **Test the GPX drop-in profiler.**

   - Click **Import GPX** and drop a real `.gpx` file.
   - Confirm the track draws on the map and the elevation profile appears.
   - Hover the profile and confirm a tooltip/line marker shows the elevation.
   - Click **Save to this device** and confirm the route appears in local routes.

10. **Test download and round-trip.**

    - From a venue detail or local route, click **Download GPX**.
    - Confirm the downloaded file is valid GPX and contains the expected track.

11. **Stop the dev server.**

    ```bash
    # Ctrl-C or kill the Vite process
    ```

## Hand-off checklist

For each acceptance criterion, report one status:

- **Verified** — personally observed working with real data or a real browser.
- **Working locally** — command/tool ran successfully but not visually inspected.
- **Mocked** — used a synthetic fixture.
- **Environment-blocked** — missing permission, missing credential, or local environment limitation; report the exact blocker.
- **Not implemented** — out of scope for this change.

Required criteria:

- [ ] `python scripts/build_data.py` exits 0.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run build` exits 0.
- [ ] Map loads and venue pills render.
- [ ] Search returns results.
- [ ] Venue detail page renders for at least one changed venue.
- [ ] GPX drop-in profiler parses a file and draws the profile (if GPX code changed).
- [ ] Downloaded GPX round-trips (if routes changed).

## Failure reporting

If any step fails:

1. Capture the browser/app state (screenshot if possible) and the exact terminal/console error.
2. Record the file path and line number if available.
3. Note whether the failure is **code**, **data**, or **environment**.
4. Open a concise issue note with:
   - Expected vs observed
   - Exact command and output
   - Steps already attempted
   - Blocker classification: Verified / Working locally / Mocked / Environment-blocked / Not implemented

## Known limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| DEM covers Singapore only | Malaysian routes use GPX altitudes | Document in UI copy; do not recompute |
| SRTM reads canopy height | Forested summits over-report | Flag `elevationSource` and note in venue detail |
| No automated browser tests | Regressions caught by manual vertical slice | Run this skill after every data/UI change |
| `npm run dev` requires port 5180 | Port collision blocks local preview | Stop competing process; do not change default silently |
| `localStorage` shape is a public contract | Changing keys invalidates saved routes/favourites | Migrate keys or document breaking change |
| Some HDB ingest depends on OneMap | Cannot refresh HDB blocks without credentials | Use committed `data/venues/hdb-blocks.json` |
| Photos depend on Mapillary token | Cannot refresh photos without credentials | Existing `public/photos/` remain usable |
