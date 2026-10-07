# HillGPX

A free, open-source, community-built map of every hill, mountain, staircase and tall block worth climbing, and an open archive of the GPX routes up them, with honest elevation for every file.

**Live site:** https://hillgpx.com · **MIT licence** · [Help build it](CONTRIBUTING.md) · [Moderation guide](docs/MODERATION.md)

Good vertical training spots are local knowledge: the stairwell to the 40th floor, the ridge loop that gives 500 m before work, the hill the club repeats on Thursdays. HillGPX puts that knowledge on one open map. Every route, photo, rating and correction on it was added by someone who trains there.

## Principles

- **Free for everyone.** Static site on GitHub Pages, open Supabase database for contributions. No accounts, no paywall, no tracking cookies.
- **Community first.** The map grows through contributions, and contributors are credited on what they add.
- **Honest numbers.** Hills show *elevation*; stairwells and blocks show *EG* (elevation gain); routes show *EG* and *EL*. Every route says where its elevation came from.
- **Phone first.** Most people open it at the bottom of a hill.
- **Open data, clearly attributed.** Every record keeps its source and licence.

## What you can do

- Browse **900,000+ hills and mountains in 232 countries**, plus Singapore's stairwells and tall HDB blocks, on a flat or 3D terrain map.
- Search any country, town, hill or street, including the world's best-known summits wherever the map is; the map frames it.
- Open a route for its trace, EG/EL profile, the places it passes and routes it overlaps; "More details" under the profile slides the rest open. Tap a place it passes to fly there, and tap it again to go back to the whole route. Download any route as GPX.
- **Upload a GPX** without an account (up to 60 MB), from any page; on a place's page the upload opens right there. It is checked for duplicates, keeps your device's elevation, is classified as road run, trail or cycling, and is published under CC BY 4.0. Heart-rate and other device data are stripped first.
- **Add photos** (up to 12 at once, dragged in or picked), **rate and review** places, pin hazards along a route, report mistakes, and save places with the heart. Everything goes live straight away; anyone can report a photo or review, and three reports hide it until a moderator looks.
- See the community's progress toward the next goal (a number of shared routes) in the strip at the top of every page; it opens "What's mapped", with the goal ladder and how much of the map has a GPX or photo.
- Read how it works from the "Free and open source" badge at the bottom of the page; privacy, contribution terms and contact are in the footer.
- Phone first: on small screens the header and the category bar each stay on one row, and searching takes you to the map.
- Filters apply as you pick them; closing the dialog keeps your choice.

## Contributing

You do not need to write code. In order of what helps most:

1. **Data.** Upload a GPX, add a missing place, add photos, report hazards and mistakes.
2. **Feedback.** Tell us what was confusing with the [feedback form](https://github.com/StarlightsJourney/HillGPX/issues/new?template=feedback.yml).
3. **Costs and reach.** Help with hosting as it grows, or tell your running or hiking group.

The plain-language guide is [CONTRIBUTING.md](CONTRIBUTING.md). How the project is run, moderated and funded, and where it might go, is in [docs/COMMUNITY.md](docs/COMMUNITY.md).

## Development

```bash
git clone https://github.com/StarlightsJourney/HillGPX.git
cd HillGPX
npm install
npm run dev
```

The app opens at http://localhost:5180 (the port is strict). It needs no keys or `.env` file.

- [docs/DEVELOPING.md](docs/DEVELOPING.md): setup, data files, data jobs, checks, deploying
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit
- [AGENTS.md](AGENTS.md): rules and environment notes for anyone (or any agent) changing the code

**Stack:** Vite, React, TypeScript, MapLibre GL with [OpenFreeMap](https://openfreemap.org) tiles and [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), [Supabase](https://supabase.com) for community contributions, a Python data pipeline, GitHub Pages.

The browser uses Supabase's *publishable* key, which is public by design: row-level security only allows inserting new rows and reading approved ones. A fork can point at its own project with `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY`.

## Hosting, domain and search engines

### How it works

The site is static files (HTML, JavaScript, data) that any host can serve. Everything people add (GPX, photos, reviews, ratings, reports) goes from their browser straight to the Supabase database and storage, so the site behaves like a dynamic one. The only key in the code is Supabase's *publishable* key, which is meant to be public: row-level security lets it add new rows and read published ones, nothing else, and the spam limits sit in the database where no visitor can switch them off.

The site lives on **Cloudflare Pages at https://hillgpx.com** (project `hillgpx`): every merge to `main` builds and deploys automatically, every branch and pull request gets its own preview address on `hillgpx.pages.dev`, and it is free with unlimited bandwidth, DDoS and bot protection, and cookieless analytics. `www.hillgpx.com` redirects to `hillgpx.com`. GitHub Pages (`.github/workflows/deploy.yml`, https://starlightsjourney.github.io/HillGPX/) still deploys as a backup copy whose canonical links point at hillgpx.com. The repository stays public and open source.

### How it was set up (for a fork or a rebuild)

`hillgpx.com`, `.org`, `.app`, `.run`, `.io` and `.sg` were all unregistered on 6 October 2026.

1. **Domain:** create a free Cloudflare account and buy `hillgpx.com` from **Cloudflare Registrar** (at cost, about US$10 a year). Its DNS is then already on Cloudflare.
2. **Project:** Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → choose `StarlightsJourney/HillGPX`.
   - Production branch: `main`. Build command: `npm run build`. Output directory: `dist`.
   - Environment variables: `VITE_BASE` = `/`, `SITE_URL` and `VITE_SITE_URL` = `https://hillgpx.com`, `NODE_VERSION` = `20`. Optional: `VITE_CF_ANALYTICS_TOKEN`, `VITE_CLARITY_ID` (see Analytics below).
3. **Custom domain:** the project → **Custom domains** → add `hillgpx.com` and `www.hillgpx.com` (Cloudflare creates the records and the HTTPS certificate).
4. **Protection:** the domain → **Security** → turn on **Bot Fight Mode**; keep the default DDoS protection. Pages has no request limits to worry about.
5. **One canonical address:** in the GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **Variables**, add `SITE_URL` = `https://hillgpx.com`, so the GitHub Pages copy also points search engines at hillgpx.com. You can then turn GitHub Pages off (Settings → Pages) or keep it as a backup.
6. Update the live-site link at the top of this README.

Cloudflare Pages' free plan takes up to 20,000 files per deployment. The build counts them and, if the site ever grows past 19,500, leaves out the least useful place pages first (`MAX_SITE_FILES` in `scripts/build_seo.mjs`); it is at about 18,700 today. `public/_headers` sets caching and security headers there.

### Being found on Google and by AI assistants

The app keeps places behind `#venue/…` addresses, which search engines treat as the home page. So every build also writes plain pages they can read (`scripts/build_seo.mjs`, run by `npm run build`):

- a page for every hill and mountain in the local data and every summit in the world-peaks index (`/place/<slug>/`), every country (`/country/<code>/`, "Highest peaks in Japan") and every GPX route (`/route/<slug>/`), each with a title, description, photo, schema.org data and link-preview tags, and a button into the map;
- `sitemap.xml`, `robots.txt` (which names the AI search crawlers as welcome), `llms.txt` (a plain summary for AI assistants) and a `404.html`;
- plain text inside the home page itself, for crawlers that do not run JavaScript, plus link-preview tags and the preview card `public/og-image.png`.

After the site is live on hillgpx.com:

1. Add it to [Google Search Console](https://search.google.com/search-console) as a domain property (Cloudflare can add the verification record for you) and submit `https://hillgpx.com/sitemap.xml`. Do the same in [Bing Webmaster Tools](https://www.bing.com/webmasters), which also feeds ChatGPT search and Copilot.
2. Indexing takes days to weeks; links from elsewhere (club pages, Strava clubs, Reddit) speed it up.
3. Messaging apps cache link previews: a link shared before the change keeps its old card for a while.

### Analytics

Both are optional and switched on by build settings, so forks and local builds send nothing (`src/lib/analytics.ts`); the Privacy page describes whichever is on.

- **Cloudflare Web Analytics** (free, no cookies): visits, pages, countries, referrers and load speed. On Cloudflare Pages: the project → **Metrics** → enable **Web Analytics** (one click), or create a site under **Analytics & Logs → Web Analytics** and set its token as `VITE_CF_ANALYTICS_TOKEN`.
- **Microsoft Clarity** (free, a Contentsquare-style tool): heatmaps, scroll depth, rage clicks and session replays with typed text masked. Create a project at [clarity.microsoft.com](https://clarity.microsoft.com), set **Settings → Setup → Cookies** to off, and set its id as `VITE_CLARITY_ID`. The site also sends a few named events to it (search, opening and downloading routes, uploads, reviews, reports, expanding the map).

Both load after the page has painted, so they do not slow it down.

### Contributions, moderation and spam

Contributions publish straight away. Two database migrations (applied to the live project) keep that safe: `20261006000000_spam_limits.sql` (per-connection hourly and daily caps, one review per place per day, daily ceilings, no links, hourly file ceilings; only a salted one-way hash of the network address is kept, for a day) and `20261007000000_auto_publish.sql` (photos publish at once, and anything three different people report is hidden until a moderator looks). How to work the reports queue is in [docs/MODERATION.md](docs/MODERATION.md).

### Running costs

Everything runs on free plans: Cloudflare Pages (or GitHub Pages), Supabase free (500 MB database, 1 GB file storage, 5 GB of downloads a month), OpenFreeMap, AWS terrain tiles and Open-Meteo, plus the domain (about US$10 a year). Supabase pauses free projects after a week without requests; `.github/workflows/keepalive.yml` pings it every three days. Supabase Pro (about US$25 a month) is only worth it when its **Usage** page shows file storage past about 800 MB or downloads past about 4 GB a month; community photos are what grows. Open-Meteo's free tier is non-commercial: revisit it before any sponsorship.

## Why the GPX limit is 60 MB

Phones parse the file in the browser, and much larger files can crash a mobile tab. Supabase's free plan caps storage, so files are stripped and gzipped and the map keeps a 4,000-point track. A cap also stops anyone filling the storage with junk. If a file is too big, export it without heart-rate/power data, or as a course rather than an activity.

## Data sources and licensing

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, served by [OpenFreeMap](https://openfreemap.org).
- Worldwide summits from [GeoNames](https://www.geonames.org) (CC BY 4.0) and OpenStreetMap (ODbL).
- Summaries from [Wikipedia](https://en.wikipedia.org) (CC BY-SA); photos from [Wikimedia Commons](https://commons.wikimedia.org) and [Mapillary](https://www.mapillary.com), each credited.
- Weather from [Open-Meteo](https://open-meteo.com) (CC BY 4.0, non-commercial).
- Terrain from [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/).
- HDB data from [data.gov.sg](https://data.gov.sg); geocoding via OneMap and [Photon](https://photon.komoot.io).
- Community routes and reviews CC BY 4.0; community photos under the licence the contributor chose.

## Known limitations

- The bundled terrain model covers Singapore only. Elsewhere, files without elevation use AWS Terrain Tiles (~38 m), which smooths short, steep pitches.
- GeoNames summits without a surveyed height use SRTM elevation, which can be tens of metres off on sharp peaks.
- Ratings only cover reviews left on HillGPX; places without any show "New".
- Routes are the largest gap, which is exactly where contributions help most.
- The world-peaks index leaves out summits already in the local hill data (so the map has no duplicate pins); country rows, country pages and search add those back, which is how Mount Fuji appears. A few GeoNames heights are wrong at the source (Azumaya San is listed at 3,254 m; it is about 2,350 m).

## Licence

Code is MIT. Venue, GPX and photo records keep the licence and attribution of their source; only contribute material that permits redistribution.
