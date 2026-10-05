# HillGPX

A free, open-source, community-built map of every hill, mountain, staircase and tall block worth climbing, and an open archive of the GPX routes up them, with honest elevation for every file.

**Live site:** https://starlightsjourney.github.io/HillGPX/ · **MIT licence** · [Help build it](CONTRIBUTING.md)

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
- Read how it works from the "Free and open source" badge at the bottom of the page.
- Phone first: on small screens the header stays on one row, Climbs/Routes and Filters sit above a scrolling row of categories, and searching takes you to the map.

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

## Hosting and a custom domain

The site is fully static, so any static host works; the repo deploys to GitHub Pages on every push to `main` (`.github/workflows/deploy.yml`).

To serve it from your own domain:

1. Add `public/CNAME` containing just the domain (for example `hillgpx.org`). The deploy workflow sees the file and builds for the site root instead of `/HillGPX/`.
2. At your DNS provider, point the apex domain at GitHub Pages with four `A` records (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`) and `www` with a `CNAME` to `starlightsjourney.github.io`.
3. In the repository's **Settings → Pages**, enter the domain, wait for the DNS check, then tick **Enforce HTTPS**.
4. Update the live-site link at the top of this README, `docs/DEVELOPING.md` and any links shared elsewhere.

Contributions (GPX, photos, reviews, ratings, reports) work from the first visit on any domain: they go straight from the browser to Supabase with the publishable key, and row-level security allows only inserting new rows and reading approved ones. Moderation (photos, route photos and reports start as `pending`) happens in the Supabase dashboard's Table Editor. Before a launch, check the Supabase plan's storage and egress limits, and revisit Open-Meteo's non-commercial terms if the site ever carries sponsorship.

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
