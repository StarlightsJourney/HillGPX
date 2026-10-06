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

End-to-end: `npx playwright test --workers=2`. With the default worker count on a laptop, several browsers each loading the 6 MB venue list and a software-rendered map time out on `.result-card`; that is load, not a regression.

## Environment quirks and required permissions

- **Port 5180 is strict.** `vite.config.ts` sets `strictPort: true`; if another process holds the port, `npm run dev` fails loudly. Stop the other process or temporarily override `PORT`.
- **OneMap credentials** are only needed for `scripts/ingest_hdb.py`. Without them, do not run that script; use the committed `data/venues/hdb-blocks.json`.
- **Mapillary token** is only needed for `scripts/fetch_photos.py`. Without it, photos are not refreshed.
- **Python** must be available. `scripts/build_data.py` uses only the standard library. On this macOS machine the command is `python3` (there is no `python`), and the Python 3.14 install has no CA bundle — network scripts fall back to `certifi` or `/etc/ssl/cert.pem` via `ssl_context()` in `scripts/fetch_peaks.py`.
- **Route imports** go through `scripts/import_gpx.py` (file/URL, `--osm-relation`, or `--strava-route` via the official API with the owner's token). Do not scrape Strava web pages; it breaks their terms.
- **Design layer**: patterns follow Airbnb (search pill, icon category bar, listing cards, pill pins, listing carousel, review grid). New visual work goes in `src/design.css`; honour `prefers-reduced-motion`. Every page uses `SiteHeader` / `SiteFooter` from `src/components/SiteChrome.tsx` — do not add page-specific headers or a hamburger menu (it was removed as redundant). Dialogs use `src/components/Modal.tsx`.
- **Venue conditions** come from Open-Meteo (`src/lib/conditions.ts`, keyless, CORS). Its free tier is non-commercial; revisit before any sponsored launch.
- **Header units control** is one m/ft switch button (`HeaderControls`): a click anywhere on it swaps units.
- **Goal strip** (`MilestoneBar` in `Milestones.tsx`) is the top-most strip of `SiteHeader` on every page. The count runs up on arrival, the line rolls through four short facts centred on the page with its chevron (pauses on hover/focus, static under reduced motion), and progress is a 3 px line along the strip's bottom edge with a glint. Goals are plain route counts (10, 25, 50 … 5,000, then every 5,000); no named medals. Nothing opens on hover; a click opens the "What's mapped" modal (`CoverageModal`: ring, milestone steps, icon tiles). It has a fixed height and scrolls away on the landing and venue pages while the logo row stays sticky; on the map page the whole header stays. *Add a GPX* stays at the top right of the header row. There is no separate coverage pill on the map; the strip replaced it.
- **Scroll lock:** dialogs lock the page with `lockPageScroll()` from `src/lib/dom.ts`, which pads the body by the scrollbar width so the page does not jump sideways. Do not set `body.style.overflow` directly. (`scrollbar-gutter: stable` was tried and broke widths in headless test browsers.)
- **Wordmark:** `Wordmark` in `SiteChrome.tsx` — mark plus "hillGPX" in one accent colour, Nunito 700 subset to those letters via Google Fonts `text=` (see `index.html`).
- **Header search** is the same one-field "Where" pill with the same placeholder on every page (landing and training use `HomeSearch` from `Landing.tsx`; map and venue use `SearchBar`). The landing no longer has a Climbs/Routes toggle; that lives in the map's category bar.
- **Placeholders**: every place without a photo uses `PlaceArt` (`VenueThumb.tsx`): a ridge for terrain, a plain grey tile with the type icon for built climbs (the drawn skyline was removed as too decorative). Do not add another placeholder style.
- **Descriptions format** is enforced in `describe_venues.py` (two sentences, ≤34 words, no em dashes/semicolons); keep the validator in sync with the prompt.
- **Route activity** icons (runner, mountain, bike) live in `src/lib/activityGlyphs.ts`; climb category icons use the same stroke style (`CLIMB_PATHS` in `FilterBar.tsx`). There is no "Big climbs" category; minimum EG lives in Filters. They feed the category bar, `ActivityTag` and route pins. Category slots are fixed-width so Climbs/Routes do not shift.
- **Landing**: the country marquee and infinite country rows (4 rows per batch, up to 24) come from `byCountry` / `rows` / `top` in `public/data/peaks/index.json` (rebuild with `fetch_world_peaks.py`, which keeps `photos.json`). `rows` holds each country's 12 landing summits (skipping sub-peaks within 3 km and ranges). Country boxes can have `east > 180` when a country crosses the antimeridian; `src/map/camera.ts` frames them. Every landing row uses one `PlaceTile`: no badge on the photo, region omitted (the row title says it), and it ends with a "See all" card; the title itself links with a chevron.
- **Community route thumbnails** are rendered in the uploader's browser at publish (`src/map/renderThumb.ts`) into the `route-thumbs` bucket; committed routes still use `scripts/render_route_thumbs.ts`. Any route card without a stored image (saved-on-device routes, a missing or stale file) renders its basemap live in the browser, one at a time (`liveThumb` in `RouteThumb.tsx`), so every trace has a map behind it.
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
- **MapLibre worker on GitHub Pages:** MapLibre 6 resolves its worker from `import.meta.url`, and Vite does not emit that file, so a Pages build showed a blank map while dev worked. `src/map/worker.ts` bundles it (`?worker&url`) and calls `setWorkerUrl()`; import it first in any module that creates a map. Check production with `VITE_BASE=/HillGPX/ npm run build && npx vite preview --base /HillGPX/`.
- **Header search:** landing and map both use the `.home-search` pill in `SiteHeader`'s centre (the map's `SearchBar` is a one-field version). Side columns are equal so it stays centred. The pill has no "Where" label; its placeholder is `SearchHint` ("Search" + a place that rolls over every 2.6 s, still under reduced motion), laid over the empty input. Below 744 px the header stays one row (mark only, +, m/ft) and suggestions span the screen; the + shows an "Add a GPX" tooltip below 900 px. Do not reintroduce the old collapsing circle or a second header row.
- **Narrow category bar:** below 744 px it stays one row, centred as a group: a compact Climbs | Routes toggle, the category icons (only as wide as they need, scrolling sideways when they do not fit) and Filters as a round icon button with its count (label kept for screen readers in `.filter-open-label`). (A two-row version left empty space; do not bring it back.)
- **Filter dialogs apply live:** every choice in Route filters applies immediately; the climbs Filters dialog commits after a 450 ms pause (so dragging the height handles does not re-filter on every step) and on any close (X, Escape, scrim). The footer button only closes. Choices are wrapping chips (`.seg`, two across on phones) so labels like "Up to 25 km" never truncate.
- **Venue page scrolling:** the venue page is a fixed layer over the map page and calls `lockPageScroll()` while open, so only its own scrollbar shows. With two scrollbars its header sat 8 px left of the other pages and jumped when a dialog opened. Test alignment with classic scrollbars (Chromium `--disable-features=OverlayScrollbar`, without `--hide-scrollbars`); macOS overlay scrollbars hide these bugs.
- **Add a GPX** links call `openImportHere` (`src/lib/contribute.ts`): on a venue page they open the dialog over the page via the `hillgpx:import` event instead of navigating to `#import`.
- **Searching an area** (`showArea`) closes an open stored route and, on phones, switches to the map; a landing link (`#map/…`) still opens on the list.
- **Map page layout** follows Airbnb: the page scrolls (not the list pane), header and category bar sit in a sticky `.map-top` whose height is `--map-top`, the map is sticky beside the list, and the full-width `SiteFooter` comes after both. On narrow screens the footer follows the list and is hidden in map view. Scroll to top with `window.scrollTo`, not the list pane.
- **Route panel** is compact by default (title, Distance/EG/EL, small profile; "More details" expands into a content-height sheet, numbers in a 3-column grid). The name and the Passes chips stay on one line and drift in a loop when too long (`Marquee.tsx`). The (i) card floats in a portal (`InfoTip`) so the panel cannot clip it. A light (ink tail, brand-colour head) runs twice round the panel edge when a route opens. "More details" is a toggle under the profile; the extra content is always rendered and slides open (`.route-more`, grid rows 0fr → 1fr, `inert` while folded). Tapping a Passes chip again releases it and flies back to the route. Opening a route keeps the split view; the expand control is an ink button whose icon breathes (`.map-expand-ctrl.invite`) while a route is open beside the list. On every resize step the map re-fits the framed route with no animation (`ResizeObserver` in `MapView`), so expanding and minimising glide. On the expanded map with a route open the category bar folds (`.map-filters.folded`, `display: none`, contents fade back in): never animate its height, which resized the map every frame and shook the page. When the map is at least 600 px wide the panel is a side sheet centred top to bottom on the left. Moving between routes flies the camera (fitBounds 1.4 s); `frameTo` animates once the map has fired `load` (`startedMaps`), not on `map.loaded()`, which is false whenever tiles are loading. When the map is at least 720 px wide the panel is a 380 px side sheet; otherwise it docks along the bottom. `panelClearance()` in `MapView.tsx` returns left or bottom padding. Route credits and "Report an issue with this route" live inside the (i) `InfoTip`.
- **World-summit photos:** `public/data/peaks/photos.json` is attached to world-peak venues as `venue.photo` with a full Commons URL in `file`. Always build image URLs with `photoSrc()` from `src/lib/venues.ts`, never `BASE_URL + file`.
- **Open-source notice:** `OpenSourceNotice.tsx` shows a small centred first-visit card with the brand mark once per session (`sessionStorage` key `hillgpx:openSourceNoticeSeen`), **on the landing page only** (venue pages open in new tabs with their own session, so it would greet people on every place). `OpenSourceBadge` (dark ink pill) sits at the bottom centre of every page: of the window on landing (`landing`) and on venue/training pages (`corner`), of the map on the map page (`on-map`, hidden while a route is open); off the landing page it hides below 900 px. It is centred with `calc(50% - var(--scroll-lock-pad) / 2)` so it does not move when a dialog locks the page. On venue pages it is portalled to `body`: inside the page layer, the slide-in transform carried the fixed badge off centre while it animated. Do not name its classes `app` or `map`: both collide with layout rules. The "How hillGPX works" dialog must fit without scrolling and stay plain: no accent colour, mark + one-line promise (do not promise "no ads, no accounts": that may change), three one-line link tiles with arrows (Free GPX → #routes, Open code → GitHub, Add a GPX → upload) whose one-line description shows underneath on hover/focus; never tiles that look pressable but do nothing, then a short founder quote (problem, fix, hope; no personal details) with the portfolio About photo on white.
- **Landing rows:** one row per country. A country with a GeoNames "Highest peaks in …" row (`worldRowCountries`, first 24) gets no "Peaks in …" row from the local data.
- **Venue route cards** are the map: name over it, Show on map / Download as round icons top right, numbers and profile lift over the map on hover/focus. Nearby cards use `NearbyThumb`, which falls back to the same summit or Commons photo the place's own page leads with.
- **Hosting:** add `public/CNAME` for a custom domain; the deploy workflow then builds with `VITE_BASE=/` and sets `VITE_SITE_URL`/`SITE_URL` (README "Hosting, domain and search engines").
- **Search engines:** `npm run build` runs `scripts/build_seo.mjs` after Vite, writing static `/place/<slug>/` (local hills + world-peak index summits; ranges and HDB blocks skipped), `/country/<code>/` and `/route/<slug>/` pages plus `sitemap.xml`, `robots.txt` and `llms.txt` into `dist/`. `index.html` uses `%VITE_SITE_URL%` (default set in `vite.config.ts`) for canonical and preview tags; `public/og-image.png` is the 1200×630 preview card. The world-peaks index is missing Mount Fuji and lists ranges (feature `MTS`) among summits: a data issue in `fetch_world_peaks.py`, not fixed yet.
- **Place pages load directly:** opening `#venue/…` (cards open new tabs) shows `VenueDetailSkeleton` until the data arrives and does not mount `MapView` until you leave the place page (`mapNeeded` in `App.tsx`). The place page has no entrance animation: fading it in showed the map page underneath.
- **Info pages:** `#privacy`, `#terms` and `#contact` render `InfoPage.tsx` (tabs, one text column), linked from the footer's About column. `CONTACT_EMAIL` in `src/lib/contribute.ts` is empty until the maintainer picks a public address; the contact form is `.github/ISSUE_TEMPLATE/contact.yml`.
- **Spam limits:** `supabase/migrations/20261006000000_spam_limits.sql` (per-connection hourly/daily caps from a salted IP hash kept one day, one review per place per day, daily table ceilings, no links, hourly storage ceilings). It must be applied by the owner in the Supabase SQL editor; it was tested against Postgres 15 in Docker with stand-ins for Supabase's roles, `extensions` and `storage` (`/tmp/hillgpx-db/`). PL/pgSQL does not short-circuit `new.<column>` across tables: read fields through `to_jsonb(new)`. `apiErrorMessage` in `src/lib/api.ts` turns the database's messages into the text visitors see.
- **Moderation and costs:** `docs/MODERATION.md`. `.github/workflows/keepalive.yml` pings Supabase every three days so the free project is never paused (GitHub disables scheduled workflows after 60 days without repository activity).
- **Venue page:** photos open the full-screen viewer directly (no "Show all photos"; the last grid cell shows "+N"). "Add photos" takes up to 12 at once with drag and drop, add-more and remove, and per-photo progress. Empty sections (no GPX, no reviews) use the white hairline `.venue-empty` card / review-form card, never a tinted box.
- **Contributor docs:** `CONTRIBUTING.md` is for the public (data first, then UX feedback, then budget). The technical reference that used to live there is `docs/DEVELOPING.md`.
- **Git hooks:** `npm install` runs `prepare`, setting `core.hooksPath` to `.githooks/`. The `commit-msg` hook strips AI/bot `Co-authored-by:` and "Generated with …" lines. Commit `9f800f7` predates it and still carries a Devin trailer; removing that needs a history rewrite and force-push, which only the coordinator may decide.
- **Venue pages open in a new tab** (`target="_blank"` on every `#venue/<slug>` link, `window.open` for map pins), like Airbnb listings, so the page has no back button: site header with search, content, footer. "Show on map" moves that tab to `#map`.
- **Venue photos**: `venuePhotos(venue)` in `src/lib/venues.ts` is the one ordered list (stored cover first). The cover is the same everywhere; Commons photos found nearby come after it, captioned "taken nearby", and are never used for blocks, stairs or car parks. Compare photos with `photoKey()`, which reduces every Wikimedia URL form to the file name. `public/data/peaks/photos.json` gives each summit its own picture; `fetch_peak_photos.py` will not reuse one photo for two summits.
- **Ratings**: `RatingLabel` shows "★ 4.85 (12)" or "★ New". Never show ratings scraped or copied from Google Maps or other sites (their terms forbid it, and the numbers would not be ours). Cards only see ratings in the static data; live Supabase reviews show on the venue page.
- **Category chips** are disabled when the area on screen has none of their kind (HDB blocks outside Singapore); a chip already selected stays selected and the list shows its empty state.
- **Search** (landing and map) matches countries from `countrySummaries()`, destinations, towns and all loaded venues, and falls back to `geocodePlace()` in `src/lib/regions.ts` (Photon, keyless) on submit. It never moves to the user's location by itself; `MapView` releases MapLibre's follow-location lock before any camera move it makes.
- **Brand icon** is an "H" mark: `public/favicon.svg`, `public/icons/*.png`, `public/site.webmanifest`, and `Mark` in `icons.tsx`. Keep them in sync.
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
- **`main` is protected** (GitHub ruleset "Protect main"): changes land only through a pull request with 1 approval; force pushes and deletion are blocked. Collaborators (maintainers) may approve and merge others' PRs; the repo admin can bypass. Classmates contribute from forks (see `CONTRIBUTING.md`).
- **No bot/AI co-author trailers.** Use a normal commit message.
- **Push only when explicitly asked.** The coordinator decides when the branch is ready for the remote.

## External references

- Mobbin UX/flow reference: `.devin/skills/mobbin/SKILL.md`
- Vertical-slice workflow skill: `.devin/skills/hillgpx-workflow/SKILL.md`
- Architecture: `docs/ARCHITECTURE.md`
