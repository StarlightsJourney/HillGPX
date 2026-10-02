# Help build HillGPX

HillGPX is free and open source. It is built by volunteers: runners, hikers
and stair climbers who share what they know. Anyone can help, and **you do not
need to write code**.

There are three ways to help. They are listed in order of how much the project
needs them.

1. [Add data](#1-add-data-most-needed): routes, places, photos and corrections
2. [Help make it easier to use](#2-help-make-it-easier-to-use)
3. [Help with costs and spread the word](#3-help-with-costs-and-spread-the-word)

If you write code, see [Working on the code together](#working-on-the-code-together)
at the end.

---

## 1. Add data (most needed)

The map is only as good as what people add to it. This is the most useful help
of all.

### Share a GPX route

A GPX file is the track your watch or phone app records. To share one:

1. Open [the map](https://starlightsjourney.github.io/HillGPX/#map).
2. Press **Add a GPX** at the top right.
3. Choose the file and check the details. Press publish.

You do not need an account. Your route goes on the map straight away, with your
name on it, for anyone to download (licence: CC BY 4.0).

Please:

- **Only share routes you recorded yourself.** Do not re-upload someone else's.
- **Check where it starts.** If the track begins at your front door, trim the
  start and end in your watch app first.
- Duplicates are fine to try. The site tells you if the route is already there.

### Add a missing place

Know a hill, staircase or tall block that is not on the map? Use the
[Add a place form](https://github.com/StarlightsJourney/HillGPX/issues/new?template=add-place.yml).
It needs a free GitHub account. Tell us the name, where it is, and how you know
its height. Leave the height empty if you are not sure: an empty box is better
than a wrong number.

Only add public places. Do not add anywhere people are not allowed to go.

### Add a photo

Open a place's page and press **Add photos**. A volunteer checks each photo
before it appears, usually within a day. Only send photos you took yourself.

### Fix something that is wrong

Wrong height, closed staircase, hazard on a trail? Press **Report an issue** on
the place or route page. You can also pin a hazard (a landslip, a fallen tree)
at the right spot along a route.

If you measured a height yourself and want to correct the data directly, the
steps are in [docs/DEVELOPING.md](docs/DEVELOPING.md#verify-a-venues-elevation).

### Rate and review a place

On a place's page, leave a rating and a few practical notes: gates and opening
times, water, shade, the best time to go. These help the next person most.

---

## 2. Help make it easier to use

HillGPX is for everyone, of every age, so it has to be simple. If something
confused you, that is useful to us, not your fault.

- **Tell us what was hard.** Use the
  [feedback form](https://github.com/StarlightsJourney/HillGPX/issues/new?template=feedback.yml).
  Say what you were trying to do and what happened. A screenshot helps.
- **Suggest a better layout.** A sketch on paper, or a link to another app that
  does it well, is welcome. We follow patterns people already know from apps
  like Airbnb, and we prefer clear over clever.
- **Try it on your own phone.** Most people use HillGPX outdoors on a phone. If
  something is too small to tap or hard to read in sunlight, tell us.

---

## 3. Help with costs and spread the word

Today the site runs on free services: GitHub Pages for the website, Supabase
for shared routes and photos, OpenFreeMap for the map. As more people add
photos, storage will start to cost money (about US$25 a month for the next
Supabase plan).

- **Donate.** A donation page is being set up. Until then, open an issue titled
  "Support" and the maintainer will reply. Every cent and every expense will be
  published.
- **Share the milestones.** The bar under the header shows the community's
  progress, from *First tracks* at 10 routes to *Every hill* at 5,000. When we
  reach one, share it with your running club or hiking group. New people bring
  new routes.
- **Tell your group about it.** One message in a club chat can bring more
  routes than anything else.

How the project is run and funded, and the promises that come with it (no
paid rankings, no selling data, sponsored items always labelled), are in
[docs/COMMUNITY.md](docs/COMMUNITY.md).

---

## Working on the code together

Everyone, classmates included, works the same way: in your own copy (a
**fork**), then a **pull request** back to this repository. You do not need to
be invited to start.

### 1. Make your copy

1. Press **Fork** at the top of the
   [repository page](https://github.com/StarlightsJourney/HillGPX). This makes
   your own copy under your GitHub account.
2. Clone your fork and install:

   ```bash
   git clone https://github.com/<your-username>/HillGPX.git
   cd HillGPX
   git remote add upstream https://github.com/StarlightsJourney/HillGPX.git
   npm install
   npm run dev
   ```

### 2. Make a change

1. Get the latest version first:

   ```bash
   git checkout main
   git pull upstream main
   ```

2. Make a branch for each piece of work: `feature/<short-name>` or
   `data/<place-or-route>`.

   ```bash
   git checkout -b feature/route-panel-labels
   ```

3. Commit your work and push the branch **to your fork**:

   ```bash
   git push origin feature/route-panel-labels
   ```

### 3. Open a pull request

GitHub shows a **Compare & pull request** button after you push. Open the pull
request against `main` of `StarlightsJourney/HillGPX`. In the description, say
what changed and why, and add a screenshot for anything visible.

Keep pull requests small: one feature or fix each. Small ones get reviewed
and merged much faster.

### 4. Review and merge

`main` is protected, because every merge to it updates the live site:

- Nobody can push to `main` directly. Every change goes through a pull request.
- A pull request needs **one approval** from a maintainer before it can be
  merged.
- **Maintainers** are the people the project owner has added as collaborators.
  Any maintainer can approve and merge, but not their own pull request. A
  second person always looks at a change before it goes live.

If a reviewer asks for changes, push more commits to the same branch. The pull
request updates by itself.

### Checks to run before opening a pull request

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Setup details, the data formats and the rules the code relies on are in
[docs/DEVELOPING.md](docs/DEVELOPING.md). The architecture is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

AI tools are fine to use, but commit under your own name. `npm install` turns
on a git hook that removes bot "Co-authored-by" lines, so tools do not show up
as contributors.

---

## Licences

By contributing you agree to share your work under these licences:

| What | Licence |
|---|---|
| Code | MIT |
| GPX routes | CC BY 4.0 |
| Photos | CC BY-SA 4.0, CC BY 4.0 or CC0 (your choice) |
| Reviews | CC BY 4.0 |

## Be kind

Be patient and polite with everyone, especially people who are new to this.
Report anything unkind to the maintainer.
