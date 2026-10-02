# Running HillGPX as an open, community-owned project

This is the playbook for keeping HillGPX free, trustworthy and alive: how it is licensed, how people contribute, how contributions are checked, how the project is governed, what it costs to run, and how it could pay for itself without selling out the people who built it.

## 1. What "open" means here

| Layer | Licence | Why |
|---|---|---|
| Code | MIT | Anyone can fork, self-host or build on it. |
| Contributed routes (GPX) | CC BY 4.0 | Free to download and reuse, with credit to the contributor. Same spirit as OpenStreetMap traces. |
| Contributed photos | CC BY-SA 4.0, CC BY 4.0 or CC0 (contributor's choice) | Photos stay credited and shareable. |
| Reviews | CC BY 4.0 | Reusable with attribution. |
| Summits and map data | ODbL (OpenStreetMap), CC BY 4.0 (GeoNames) | Inherited from the sources; credited on the site. |

Rules that keep this true:

- **No account, no paywall, no tracking** for the core: browsing, downloading GPX, uploading, rating.
- **Everything contributed is exportable.** The database schema is in `supabase/migrations/`; a full dump of approved routes, photos and reviews should be published regularly (see §6) so the community never depends on one host.
- **Licences are chosen at upload time** and stored with every record. Nothing is imported under assumed licensing.

## 2. How people contribute

| Contribution | Where | Account needed | Goes live |
|---|---|---|---|
| Upload a GPX | "Add a GPX" on the map, or a venue page | No | Immediately |
| Rate and review a place | Venue page | No | Immediately |
| Add photos | Venue page → "Add photos" | No | After a quick volunteer check |
| Add a missing place | Menu → "Add a place" (GitHub issue form) | GitHub | When merged |
| Correct an elevation | `CONTRIBUTING.md` | GitHub | When merged |
| Improve the code | Pull request | GitHub | When merged |

Design principles for contribution flows:

- **One screen, no sign-up.** Every extra step loses contributors.
- **Show the effect straight away.** A published route appears on the map immediately; the coverage pill counts it.
- **Credit visibly.** Contributor names appear on routes, photos and reviews.
- **Ask for consent in plain words** (own track / right to share, licence) rather than legal text.

## 3. Keeping quality high

The data is only useful if people trust it.

**Automatic checks (already built)**

- Duplicate GPX: a track fingerprint is unique in the database, and near-identical tracks (≥90% overlap both ways, distance within 10%) are refused on upload with a link to the existing route.
- Size and shape limits on every column (`supabase/migrations/`), 5 MB GPX and 8 MB photo caps, image re-encoding that strips EXIF location.
- Row-level security: the public key can only insert new rows and read approved ones. Nobody can edit or delete through the API.
- Honest numbers: elevation source (device, terrain model, terrain tiles) and recording date are shown on every route; tracks older than three years are flagged.

**Human moderation**

- Photos (venue photos and photos/hazards pinned along routes) land as `pending`; a volunteer approves them in the Supabase dashboard (`status = 'approved'`) or rejects them. Target: within 24 hours. Pending files are stored under unguessable IDs and never listed, so nothing explicit can reach the site before a person has looked at it.
- Reports (wrong details, hazards, closures, photo problems) arrive in the `reports` table for the same volunteers.
- **Explicit-image protection, in layers:** (1) human approval before anything is public — in place today; (2) next, an automatic pre-screen in a Supabase Edge Function using a free vision/safety model (e.g. a Groq vision model or an open NSFW classifier) that auto-rejects obvious cases and fast-tracks clean ones; (3) once accounts exist, trusted contributors skip the queue. This keeps uploading one-tap easy without letting abuse through.
- Routes and reviews publish immediately but can be set to `rejected` by a moderator. Add a "Report" button per item when volume grows.
- Start with 2–3 trusted moderators from local running and hiking clubs; rotate monthly.

**Coming later (agreed direction)**

- Optional accounts so hearts, reviews and uploads follow you across devices and build a contributor profile.

**When volume grows**

- Rate-limit anonymous inserts per IP with a Supabase Edge Function in front of the inserts.
- Add optional sign-in (GitHub or email magic link) for contributors who want a profile and history; keep anonymous contribution available.
- Trust levels: contributors with N approved items skip photo moderation.

## 4. Ratings that mean something

- One 1–5 rating per review, with optional text; the average and count are shown under the photos.
- Reviews prompt for practical details (gates, water, shade, best time) — the things the next person needs.
- AI summaries (`scripts/describe_venues.py`) only fold in points multiple reviewers agree on, never quote or name people, and are regenerated when inputs change. The summary always states its sources.
- Anti-gaming: no incentives tied to ratings, sponsored places can never be re-ranked by rating, and moderators can remove brigading.

## 5. Governance

- **Maintainers** merge code and data, set roadmap priorities, and hold the infrastructure keys. Keep at least two, so the project never has a single point of failure.
- **Moderators** approve photos and handle reports. No code access needed.
- **Regional stewards** (later) look after data quality in a country or city — often a club captain.
- Decisions are made in public GitHub issues/discussions. Anything touching money or sponsorship gets a public discussion and at least a week for comments before it ships.
- Adopt a short Code of Conduct (Contributor Covenant) and link it from `CONTRIBUTING.md`.
- Recognition: a contributors page, monthly "most routes added" shout-outs, and region coverage milestones ("Hong Kong: 50% of summits have a GPX").

## 6. Keeping the site running

**Costs today (free tiers)**

| Service | Use | Free tier |
|---|---|---|
| GitHub Pages | Static site and data | 1 GB site, 100 GB/month bandwidth |
| Supabase | Routes, photos, reviews | 500 MB database, 1 GB storage, 5 GB egress |
| OpenFreeMap | Basemap tiles | Free, no key |
| AWS Terrain Tiles | Elevation and hillshade | Free (AWS Open Data) |
| Groq / FreeLLMAPI | Build-time descriptions | Free tiers |
| Open-Meteo | Venue weather | Free for non-commercial use; a commercial plan is needed once the site carries sponsorship |

**What will run out first:** Supabase storage (photos) and egress. Mitigations, in order: compress photos harder; serve approved photos from GitHub Pages by periodically exporting them into the repo; move to Supabase Pro (~US$25/month) once sponsorship covers it.

**Operational habits**

- Weekly export of approved routes/photos/reviews into the repository (a scheduled GitHub Action) — this is the community's backup and makes the archive mirrorable.
- Keep `scripts/` re-runnable and documented so anyone can rebuild the data.
- Two maintainers with dashboard access; secrets only in GitHub Actions secrets and Supabase, never in the repo.
- Watch the Supabase usage page monthly; publish the numbers.

## 7. Paying for it, without selling out

Principles first, so the community can hold the project to them:

1. The core map, GPX downloads and uploads stay free forever.
2. Money never changes data: no paid ranking, no hidden placements, no selling of user data or GPS tracks.
3. Anything sponsored is labelled "Sponsored" or "Partner", every time.
4. Income and spending are published (Open Collective makes this automatic).

Options, roughly in the order they make sense:

| Stage | Source | Notes |
|---|---|---|
| Now | **Open Collective / GitHub Sponsors** donations | Transparent ledger; a "Support HillGPX" link in the menu and footer. Covers hosting early. |
| Now | **Grants** | OpenStreetMap-adjacent and open-data funds, outdoor-industry community funds, local sports councils, university research partnerships on activity data. |
| Growing | **Trail event listings** | Race organisers pay a small fee to pin an event on the map with dates and a registration link; free for community and charity runs. |
| Growing | **Partner gear showcases** | Trail-running and hiking brands sponsor a labelled card on region pages ("Gear for Hong Kong trails"). Flat fee, not per-click; no tracking pixels. |
| Growing | **Sponsored places and posts** | Clearly labelled cards for gyms, stair-climb events, guided hikes. Never mixed into rankings. |
| Later | **Club and coach tools** | Optional paid features for clubs (private route collections, group training goals) while everything public stays free. |
| Later | **Data partnerships** | Aggregated, anonymised coverage statistics for parks agencies or tourism boards — only with explicit contributor-facing policy and opt-out. |
| Later | **Cycling expansion** | Same model for cycling routes and climbs widens the audience and sponsor base. |

A healthy target is that donations and grants cover infrastructure, and partner income funds maintainer time and moderation.

## 8. Roadmap toward a GPX archive

HillGPX can grow into an open GPX archive for climbs, in the spirit of community subtitle archives like Jimaku: a single place where anyone can search, download and contribute route files, organised around the places they climb.

- Every route has a stable URL, a downloadable original file, licence and credit.
- Search and filter by place, region, activity (road run, trail/hike, cycling), distance, EG and recency.
- Duplicate detection keeps one canonical copy per track; overlapping routes are linked rather than repeated.
- Public weekly dumps so mirrors and other apps can build on the archive.
- A simple read API (Supabase REST already serves approved rows) documented for third-party tools.
