# Contributing

Most of what this project needs isn't code. It's local knowledge — which staircases are open, how much a hill actually climbs, where the good repeat venues are. If you train vertical in Singapore, you already know things this map doesn't.

## Setup

```bash
npm install
npm run dev
```

No database, no keys, no `.env`. If that isn't true for you, it's a bug — please open an issue.

For anything that regenerates data you'll also want:

```bash
pip install -r scripts/requirements.txt
python scripts/fetch_dem.py     # once, ~3.5 MB terrain model
```

---

## Add a route

The one that helps most.

1. Get a GPX. Export from your watch, Strava, or draw one anywhere that exports GPX.
2. Drop it into `data/routes/` with a descriptive kebab-case filename:
   `bukit-timah-summit-loop.gpx`, `marang-trail-repeats.gpx`
3. Rebuild and commit:

```bash
python scripts/build_data.py
git add data/routes/ public/data/
git commit -m "Add Bukit Timah summit loop"
```

The build script works out the distance, the gain, whether it's a loop, and which venues it passes. You don't need to supply any of that.

**Optional sidecar.** If you want to add detail or override the automatic venue linking, put a `.json` next to the GPX with the same basename:

```json
{
  "name": "Bukit Timah summit loop",
  "description": "Steepest line up from Hindhede. Concrete the whole way, brutal in the afternoon.",
  "surface": "road",
  "difficulty": "hard",
  "venues": ["bukit-timah-hill", "hindhede-nature-park"],
  "contributor": "@your-github-handle"
}
```

**Only upload GPX files that are yours.** Don't re-upload someone else's Strava activity. And check the track doesn't start at your front door — trim the first and last few hundred metres if it does.

---

## Verify a venue's elevation

Nearly every entry in `data/venues/hills.json` is marked `"elevationSource": "estimated"`, which means it's a seed value I wrote down and you should not trust. Several are `null`.

Two numbers matter, and they're different:

- **`summitM`** — height above sea level at the top.
- **`gainM`** — what you actually climb from the normal starting point. This is the one people train by, and it's usually much smaller. Bukit Timah's summit is around 163 m, but nobody starts at sea level.

To fix one:

1. Find a real source, or measure it — a barometric watch on a still day, averaged over a few ascents, is good enough.
2. Update the value, set `"elevationSource"` to `"verified"`, and say where the number came from in `notes`.
3. `python scripts/build_data.py`, then commit.

Cite the source. An unsourced number is the thing we already have.

---

## Add a venue

Anywhere public that people actually train on: hills, park staircases, multi-storey carparks, long overhead bridges. Add an entry to `data/venues/hills.json`:

```json
{
  "slug": "some-hill",
  "name": "Some Hill",
  "type": "hill",
  "lat": 1.3456,
  "lng": 103.7890,
  "summitM": null,
  "gainM": null,
  "elevationSource": "estimated",
  "notes": "Access from the north car park. Gate closes at 7pm."
}
```

`type` is one of `hill`, `stairs`, `park`, `carpark`, `bridge`. (`hdb_block` is generated — don't add those by hand.)

Leave a number `null` rather than guessing. A null is an honest gap someone can fill; a wrong number looks authoritative and can sit there for years.

**Access matters.** If it's private, gated, or somewhere you technically shouldn't be, say so in `notes` — or don't add it. This should not become a list of places to trespass.

---

## Code

Normal stuff: fork, branch, PR. `npm run typecheck` should pass. There's no linter yet; match the surrounding style.

A few things worth preserving, because they're the point of the project rather than incidental:

- **No backend.** The app is static files. If a feature seems to need a server, say so in an issue first — there's usually a way to keep it static, and the zero-setup clone is what makes this contributable.
- **No API keys.** A fresh clone must run with no accounts and no config.
- **Dropped GPX files never leave the browser.** People upload their training history here. It stays in their tab.
- **Never trust GPX altitude.** Re-sample against the terrain model. If you change the gain threshold in `src/lib/elevation.ts`, change it in `scripts/build_data.py` too — otherwise the app and the baked route data will quietly disagree.

## Reporting things

Issues are fine for anything: a wrong height, a staircase that's been closed, a route that's mislinked, a bug. Local knowledge is the scarce resource here — if you know something the map gets wrong, that's worth an issue even if you don't want to open a PR.
