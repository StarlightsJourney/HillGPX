# Agent guidance — HillGPX

Required reading before any agent starts work on this repo.

## Mission in one sentence

Map every hill, mountain, staircase and tall block worth climbing, worldwide, and grow an open, community-owned archive of the GPX routes up them, with honest elevation.

## Shared rules

- **One design system per project.** Reuse the existing components in `src/components/` and `src/map/`. Do not introduce a second button library, palette, or icon set.
- **Feature code stays with the feature.** Reusable visual components live in `src/components/`. Map primitives live in `src/map/`. Domain helpers live in `src/lib/`. Platform-coupled code stays behind adapters where possible.
- **Strict TypeScript.** `noImplicitAny` is on; do not use `any`. Avoid effect loops and unnecessary `useEffect` chains. Prefer derived state over mirrors.
- **No runtime secrets in source.** The web app's only credential is Supabase's *publishable* key (public by design; row-level security limits it to inserting new rows and reading approved ones). Never put a service-role key, LLM key or token in source. Scripts read credentials from `.env.local` only; never commit that file.
- **Static data is the contract.** `data/venues/*.json` and `data/routes/*.gpx` are the source of truth. Run `python scripts/build_data.py` after changing them so `public/data/venues.json` and `public/data/routes.json` stay in sync.
- **One shared persistence layer.** Shared contributions (routes, photos, reviews) go through `src/lib/api.ts` to Supabase only. In the browser, favourites live in `src/lib/venues.ts`, saved local routes in `src/lib/localRoutes.ts`, and the contributor name in `src/lib/api.ts`. Do not write other modules directly to `localStorage`.
- **Runtime writes go to OS temp or browser storage, never the repo root.** Generated fixtures, test media, and scratch output belong in `/tmp/hillgpx-*` or browser storage.
- **Do not commit secrets, models, user media, local databases, build output, or editor state.** `dist/`, `node_modules/`, `.env*`, `.DS_Store`, `.claude/`, `.vscode/`, and `scripts/.cache/` are already ignored; respect that list.
- **Shared files require coordinator sign-off.** These include `src/types.ts`, `vite.config.ts`, `tsconfig.json`, `package.json`, `.github/workflows/`, `scripts/build_data.py`, and the data schema under `data/venues/`.
- **Do not import Sheng’s color palette, typography, or radii.** HillGPX has its own design system. Mobbin is used only as a pattern/flow reference (see `.devin/skills/mobbin/SKILL.md`).

## How we work

- **Parallelize independent workstreams by default.** E.g. venue research, route GPX curation, UI polish, and build tooling can move in parallel if they touch different files.
- **Be self-critical.** Ask whether a feature is usable, not just whether it compiles. Prefer UX clarity over UI polish.
- **Use real-world data and real media for workflow testing.** Generated fixtures are a fallback. Test routes with the actual GPX files under `data/routes/`; test venue additions with real lat/lng values.
- **Document environment quirks, permission requirements, and workflow changes as you go.** Append to this file or `docs/ARCHITECTURE.md` when you discover something the next agent needs to know.

## Stack and layout

- **Frontend:** Vite 5, React 18, TypeScript 5, MapLibre GL 4, CSS.
- **Data pipeline:** Python 3, standard library for `build_data.py`; `Pillow`, `requests`, `python-dotenv` for optional ingest scripts.
- **Deploy:** GitHub Pages via `.github/workflows/deploy.yml`.
- **Community backend:** Supabase project `hillgpx` (ap-southeast-1, ref `dzpgnebkyubeptitzjlj`). Schema, RLS and buckets live in `supabase/migrations/`; apply changes as new migrations. No accounts: anonymous insert + approved read. Photos are moderated (`status`), routes and reviews publish immediately.
- **Static data:** venues, committed routes and world summit tiles are static files on GitHub Pages.

Source layout:

```
src/
  App.tsx              top-level routing and shell
  main.tsx             Vite entry point
  components/          reusable React UI
  lib/                 pure domain helpers (elevation, gpx, venues, routes, units)
  map/                 MapLibre map, markers, layers, constants
  types.ts             shared domain types and contracts
public/
  data/                generated datasets consumed by the app
  photos/              downloaded Mapillary images
data/
  venues/              curated and generated venue JSON
  routes/              contributed GPX files
scripts/             Python ingest and build scripts
```

## Module ownership

| Workstream | Owned files | Shared/coordinator files |
|---|---|---|
| Map rendering | `src/map/*` | `src/types.ts`, `src/styles.css` |
| Venue data | `data/venues/*` | `scripts/build_data.py`, `src/types.ts` |
| Routes | `data/routes/*.gpx`, `src/lib/routes.ts` | `scripts/build_data.py`, `src/types.ts` |
| GPX profiling | `src/lib/gpx.ts`, `src/lib/elevation.ts`, `src/components/GpxDropzone.tsx`, `src/components/GpxPanel.tsx`, `src/components/ElevationProfile.tsx` | `src/types.ts` |
| UI components | `src/components/*` | `src/styles.css`, `src/types.ts` |
| Ingest scripts | `scripts/fetch_dem.py`, `scripts/fetch_peaks.py`, `scripts/ingest_hdb.py`, `scripts/fetch_photos.py` | `scripts/build_data.py` |
| Build / deploy | `scripts/build_data.py`, `.github/workflows/deploy.yml`, `vite.config.ts` | — |

Coordinator-owned files require a brief heads-up in the conversation before an agent edits them.

## Persistence conventions

- The Python scripts read `data/` and write `public/data/`.
- The browser writes only through `src/lib/localRoutes.ts` and the favourites helper in `src/lib/venues.ts`.
- Keys and shapes used by `localStorage` are part of the public contract; changing them may invalidate existing user data.
- No source-tree user data. Test output goes to `/tmp/hillgpx-*`.

## Testing and validation

Agents must run these before handing off and report the results:

```bash
npm install          # if dependencies changed
npm run typecheck    # tsc --noEmit
npm run build        # tsc + vite build
python scripts/build_data.py
```

For route or venue changes, also run the workflow skill in `.devin/skills/hillgpx-workflow/SKILL.md`.

## Environment quirks and required permissions

- **Port 5180 is strict.** `vite.config.ts` sets `strictPort: true`; if another process holds the port, `npm run dev` fails loudly. Stop the other process or temporarily override `PORT`.
- **OneMap credentials** are only needed for `scripts/ingest_hdb.py`. Without them, do not run that script; use the committed `data/venues/hdb-blocks.json`.
- **Mapillary token** is only needed for `scripts/fetch_photos.py`. Without it, photos are not refreshed.
- **Python** must be available. `scripts/build_data.py` uses only the standard library. On this macOS machine the command is `python3` (there is no `python`), and the Python 3.14 install has no CA bundle — network scripts fall back to `certifi` or `/etc/ssl/cert.pem` via `ssl_context()` in `scripts/fetch_peaks.py`.
- **Route imports** go through `scripts/import_gpx.py` (file/URL, `--osm-relation`, or `--strava-route` via the official API with the owner's token). Do not scrape Strava web pages; it breaks their terms.
- **Design layer**: patterns follow Airbnb (search pill, icon category bar, listing cards, pill pins, listing carousel, review grid). New visual work goes in `src/design.css`; honour `prefers-reduced-motion`. Every page uses `SiteHeader` / `SiteFooter` from `src/components/SiteChrome.tsx` — do not add page-specific headers or a hamburger menu (it was removed as redundant). Dialogs use `src/components/Modal.tsx`.
- **Venue conditions** come from Open-Meteo (`src/lib/conditions.ts`, keyless, CORS). Its free tier is non-commercial; revisit before any sponsored launch.
- **Header units control** is an m/ft toggle (`HeaderControls`), not a globe popover.
- **Milestone bar** lives inside `SiteHeader`, so it is on every page; it is information only and centred. *Add a GPX* stays at the top right of the header. Copy is plain statements of fact (no "·"-joined slogans). Its drop-down animates from the top (keyframes must not fight `translateX(-50%)` centring, which made it slide in from the right).
- **Placeholders**: every place without a photo uses `PlaceArt` (`VenueThumb.tsx`): a ridge for terrain, a plain grey tile with the type icon for built climbs (the drawn skyline was removed as too decorative). Do not add another placeholder style.
- **Descriptions format** is enforced in `describe_venues.py` (two sentences, ≤34 words, no em dashes/semicolons); keep the validator in sync with the prompt.
- **Route activity** icons (runner, mountain, bike) live in `src/lib/activityGlyphs.ts`; climb category icons use the same stroke style (`CLIMB_PATHS` in `FilterBar.tsx`). There is no "Big climbs" category; minimum EG lives in Filters. They feed the category bar, `ActivityTag` and route pins. Category slots are fixed-width so Climbs/Routes do not shift.
- **Landing**: the country marquee and infinite "Highest peaks in …" rows (4 per batch); the country marquee and infinite "Highest peaks in …" rows come from `byCountry` / `top` in `public/data/peaks/index.json` (rebuild with `fetch_world_peaks.py`).
- **Community route thumbnails** are rendered in the uploader's browser at publish (`src/map/renderThumb.ts`) into the `route-thumbs` bucket; committed routes still use `scripts/render_route_thumbs.ts`.
- **GPX uploads** keep the file's own elevation; DEM/terrain only fill files without any. Up to 60 MB raw; simplified to ≤4,000 points; the original is gzipped before upload (`.gpx.gz`).
- **Moderation queues** (Supabase dashboard → Table Editor): `photos`, `route_photos`, `reports` (status `pending` → `approved`/`rejected`).
- **Groq**: `GROQ_API_KEY` in `.env.local`; default model `openai/gpt-oss-120b` (Llama 3.3 was retired from Groq).
- **Saved places** are the `savedOnly` filter (heart icon chip in the category bar), backed by `loadFavorites()` in `src/lib/venues.ts`. There is no Saved page. Syncing across devices needs auth (future).
- **Map camera**: frame routes immediately (`fitBounds` before the style loads, duration 0); waiting for `ready` left the map parked on Singapore. Tile fetch errors are logged, never shown in the error banner.
- **World summits** come from GeoNames (`scripts/fetch_world_peaks.py`, ~420 MB dump cached in `scripts/.cache/`), written as 5° tiles in `public/data/peaks/`. The map loads tiles for the viewport only; never merge them into `venues.json`. World-peak slugs are `gn<id>-<south>x<west>` (negatives as `m`) so links can find their tile. Overpass cannot serve the whole planet; do not try.
- **Terrain elevation:** `src/lib/terrain.ts` (browser) and `scripts/fill_route_elevation.py` sample AWS Terrain Tiles via `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/…` — that host sends CORS headers; `s3.amazonaws.com/elevation-tiles-prod/…` does not.
- **Labels:** hills/mountains show *elevation*; built climbs (HDB, stairs) show *EG*; routes show *EG* and *EL*. Use `HEIGHT_LABEL` from `src/lib/venues.ts`, never hard-code.
- **AI descriptions** (`scripts/describe_venues.py`) need `GROQ_API_KEY` or `FREELLMAPI_URL` + `FREELLMAPI_API_KEY` in `.env.local`; without one, report environment-blocked and use `--dry-run`. Keep the system prompt's style rules.
- **Photos:** stored files are 420 px. The venue page loads Commons photos sharp via `Special:FilePath?width=1280`; do not commit large derivatives (3,700+ photos would add ~500 MB).
- **Route card images** are pre-rendered, not drawn live: run `node scripts/render_route_thumbs.ts` after `build_data.py` when routes change. The filename carries a hash of the view from `src/lib/thumbView.ts`, so a changed route falls back to the plain grid until re-rendered instead of showing a misaligned trace.
- **Static SVG strings need no `xmlns`**: `parseSvg()` in `src/lib/dom.ts` adds it. Without it the XML parser returns un-rendered elements and map pins lose their icons.
- **Landing sticky header must not change size on scroll** — resizing it moves `scrollY` back across the threshold and flickers.
- **macOS file quarantines / extended attributes** (`@` in `ls -la`) can appear on downloaded files; they do not affect the build.
- **No special browser permissions** are required. Geolocation is optional and handled defensively.

If a permission or credential is missing, report the exact dialog/denial and mark the task **environment-blocked**. Do not silently disable the feature.

## Automatic escalation policy

After two materially different unsuccessful attempts at the same technical blocker, the coordinator invokes the escalation specialist defined in `.devin/agents/escalation-specialist.md`.

- The specialist works only on the delegated blocker.
- It does not refactor unrelated code, spawn subagents, or invent credentials.
- It returns a concise report: root cause, files changed with the smallest fix, verification result, and remaining risk.
- Do not delegate permission denials, missing credentials, or missing hardware. Report those and continue other work.

## Branches and commits

- **Integration branch:** `main`.
- **Feature branch naming:** `feature/<short-description>` or `data/<venue-or-route>`.
- **Commit style:** concise, describing *why* more than *what*.
- **No force-push** to `main`.
- **No bot/AI co-author trailers.** Use a normal commit message.
- **Push only when explicitly asked.** The coordinator decides when the branch is ready for the remote.

## External references

- Mobbin UX/flow reference: `.devin/skills/mobbin/SKILL.md`
- Vertical-slice workflow skill: `.devin/skills/hillgpx-workflow/SKILL.md`
- Architecture: `docs/ARCHITECTURE.md`
