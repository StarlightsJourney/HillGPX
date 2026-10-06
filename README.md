# HillGPX

A free, open-source, community-built map of every hill, mountain, staircase and tall block worth climbing, and an open archive of the GPX routes up them, with honest elevation for every file.

**Live site:** https://starlightsjourney.github.io/HillGPX/ · **MIT licence** · [Help build it](CONTRIBUTING.md) · [Moderation guide](docs/MODERATION.md)

Good vertical training spots are local knowledge: the stairwell to the 40th floor, the ridge loop that gives 500 m before work, the hill the club repeats on Thursdays. HillGPX puts that knowledge on one open map. Every route, photo, rating and correction on it was added by someone who trains there.

## Principles

- **Free for everyone.** Static site on GitHub Pages, open Supabase database for contributions. No accounts, no paywall, no tracking.
- **Community first.** The map grows through contributions, and contributors are credited on what they add.
- **Honest numbers.** Hills show *elevation*; stairwells and blocks show *EG* (elevation gain); routes show *EG* and *EL*. Every route says where its elevation came from.
- **Phone first.** Most people open it at the bottom of a hill.
- **Open data, clearly attributed.** Every record keeps its source and licence.

## What you can do

- Browse **900,000+ hills and mountains in 232 countries**, plus Singapore's stairwells and tall HDB blocks, on a flat or 3D terrain map.
- Search any country, town, hill or street; the map frames it.
- Open a route for its trace, EG/EL profile, the places it passes and routes it overlaps; "More details" under the profile slides the rest open. Tap a place it passes to fly there, and tap it again to go back to the whole route. Download any route as GPX.
- **Upload a GPX** without an account (up to 60 MB), from any page; on a place's page the upload opens right there. It is checked for duplicates, keeps your device's elevation, is classified as road run, trail or cycling, and is published under CC BY 4.0. Heart-rate and other device data are stripped first.
- **Add photos** (up to 12 at once, dragged in or picked), **rate and review** places, pin hazards along a route, report mistakes, and save places with the heart. Reviews and ratings go live straight away; photos appear once a volunteer has checked them.
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

**Hosting is already done, for free.** GitHub Pages serves the site from this repository and redeploys on every push to `main` (`.github/workflows/deploy.yml`). Anyone can open it in Chrome or any browser at https://starlightsjourney.github.io/HillGPX/. A domain name only gives it a shorter address; it does not move the hosting.

### Your own domain

`hillgpx.com`, `.org`, `.app`, `.run`, `.io` and `.sg` were all unregistered on 6 October 2026 (checked against each registry). Buy one from a registrar such as Cloudflare Registrar (sells at cost) or Porkbun, then:

1. Add `public/CNAME` containing just the domain (for example `hillgpx.com`). The deploy workflow then builds for the site root and uses the domain for link previews, canonical links and the sitemap.
2. At the registrar's DNS settings, add four `A` records for the bare domain (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) and a `CNAME` for `www` pointing to `starlightsjourney.github.io`.
3. In the repository's **Settings → Pages**, enter the domain, wait for the DNS check, then tick **Enforce HTTPS**.
4. Update the live-site link at the top of this README and `docs/DEVELOPING.md`.

### Being found on Google and by AI assistants

The app keeps places behind `#venue/…` addresses, which search engines treat as the home page. So every build also writes plain pages they can read (`scripts/build_seo.mjs`, run by `npm run build`):

- a page for every hill and mountain in the local data and every summit in the world-peaks index (`/place/<slug>/`), every country (`/country/<code>/`, "Highest peaks in Japan") and every GPX route (`/route/<slug>/`), each with a real title and description, a photo where there is one, schema.org data, link-preview tags and a button into the map;
- `sitemap.xml` (about 13,000 addresses), `robots.txt` and `llms.txt` (a plain summary for AI assistants);
- link-preview tags and a preview image (`public/og-image.png`) on the home page, so shared links show a card.

After the site is live on its address:

1. Add it in [Google Search Console](https://search.google.com/search-console) (domain property, verified with a DNS `TXT` record at your registrar) and submit `https://<your-domain>/sitemap.xml`. Do the same in [Bing Webmaster Tools](https://www.bing.com/webmasters), which also feeds ChatGPT search and Copilot.
2. Indexing takes days to weeks. Links to the site from elsewhere (a running club page, Strava club description, Reddit posts) speed it up.

`robots.txt` only counts at the root of a domain, so on the `github.io` address search engines rely on the sitemap submitted in Search Console; with your own domain it works on its own.

### Contributions, moderation and spam

Contributions (GPX, photos, reviews, ratings, reports) work on any address: they go straight from the browser to Supabase with the publishable key, and row-level security allows only inserting new rows and reading approved ones. How to approve photos, hide spam and read reports is in [docs/MODERATION.md](docs/MODERATION.md).

Spam limits live in the database (`supabase/migrations/20261006000000_spam_limits.sql`, applied once in the Supabase SQL editor): a cap per connection per hour and per day, one review per place per connection per day, a daily ceiling per kind of contribution, no web links in reviews or reports, and an hourly ceiling on new files. Only a salted one-way hash of the visitor's network address is kept, for a day.

### Running costs

Everything runs on free plans today: GitHub Pages (1 GB site, about 100 GB of traffic a month; the site is about 300 MB), Supabase free (500 MB database, 1 GB file storage, 5 GB of downloads a month), OpenFreeMap, AWS terrain tiles and Open-Meteo. Supabase pauses free projects after a week without requests; `.github/workflows/keepalive.yml` pings it every three days so that never happens. Supabase Pro (about US$25 a month) is only worth it when its dashboard's **Usage** page shows file storage past about 800 MB or downloads past about 4 GB a month; photos are the part that grows. Open-Meteo's free tier is non-commercial: revisit it before any sponsorship.

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

## Licence

Code is MIT. Venue, GPX and photo records keep the licence and attribution of their source; only contribute material that permits redistribution.
