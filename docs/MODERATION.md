# Moderating hillGPX

Everything people add goes straight from their browser to the project's
Supabase database and **appears straight away**. Nobody has to approve it
first. Instead:

- **Automatic checks** run on every contribution: per-person rate limits, one
  review per place per day, no web links, file type and size limits, and
  daily ceilings (`supabase/migrations/20261006000000_spam_limits.sql`).
- **The house rules** are on the site's Contributions page (`#terms`).
- **The community flags problems.** Every photo, route photo, review and route
  review has a Report link. Once three different people have reported the same one, it is
  hidden at once (`status` goes back to `pending`) and waits for you
  (`supabase/migrations/20261007000000_auto_publish.sql`).

So the only regular job is the reports queue. There is no admin page on the
site: moderation happens in the Supabase dashboard, where you are signed in
as the project owner.

## Where people add things

| What | Where on the site | Goes live |
| --- | --- | --- |
| GPX route | **Upload GPX** in the header (or on a place page) | Straight away |
| Photos of a place | Place page → **Add photos** on the photo grid | Straight away |
| Review and rating | Place page → **Reviews** (or the stars under the height) | Straight away |
| Route review (signed in only) | Open a route → **More details** → **Reviews** | Straight away |
| Photo or hazard on a route | Open a route → **More details** → **Photo or hazard** | Straight away |
| Report a problem | Place page or route (i) → **Report an issue**; a photo (full-screen viewer), review or route review → **Report** | Only you see it |

## The dashboard

1. Sign in at [supabase.com](https://supabase.com) with the account that owns
   the project and open **hillgpx**.
2. Open **Table Editor**. Each kind of contribution is a table: `routes`,
   `photos`, `route_photos`, `reviews`, `route_reviews`, `reports`.
3. Every row has a `status`: `pending`, `approved` or `rejected`. The site only
   ever shows `approved` rows.

### Things hidden by reports

1. Table Editor → `photos`, `route_photos`, `reviews` or `route_reviews` →
   filter `status` equals `pending`. These are the ones three people reported.
2. For a photo, open **Storage** → `photos` bucket → the path in the row's
   `storage_path` column to see it.
3. Set `status` to `approved` to put it back, or `rejected` to keep it hidden.
   The reports behind it are in `reports` (`target_slug` is the photo's or
   review's `id`): set them to `approved` once dealt with, so they do not count
   towards hiding it again.

To make hiding stricter or looser, change how many reports it takes:
`update private.limits set per_day = 2 where kind = 'hide_after_reports';`

### Route reviews

Route reviews (`route_reviews`) use the same `status` column, and the same
reports queue (`target_type` is `route_review`, `target_slug` is the review's
`id`). There is nothing to check before they go up.

| To | Change | What happens |
| --- | --- | --- |
| Hide | `status` to `rejected` | Off the site and out of the route's average; the row is kept |
| Restore | `status` to `approved` | Public again; this also undoes a hide by three reports |
| Delete | Delete the row | Gone for good; the author can post a new review of that route |

A hidden review (`pending` or `rejected`) is locked. Its author still sees it,
marked "Hidden by a moderator", but cannot edit it, delete it or post another
on that route. So use **Hide** for rude text, which cannot then come straight
back, and **Delete** for personal details, which must not be kept or for when
the person should be able to try again.

After restoring a review, also set its reports to `approved`, as above, or the
next report will hide it again.

If an author deletes a visible review, any reports against it lead nowhere.
There is no alert for new reports; check the queue.

### Routes held by the quality checks

Every GPX is checked in the uploader's browser (`src/lib/routeQuality.ts`) for
GPS jumps, impossible speeds, very short tracks and implausible altitude. A
route that fails any of those is stored **held** (`status = 'pending'`): only
the account that uploaded it can see it, with the reasons. Guests cannot hold a
route: a failing upload from a signed-out visitor is refused with the reasons.
A missing elevation only adds a note; it does not hold the route.

1. Table Editor → `routes` → filter `status` equals `pending`.
2. `quality_flags` lists what failed, with the measured value and the limit.
3. Set `status` to `approved` to release it (for a false positive) or
   `rejected` to close it. The uploader can also fix it themselves: trimming the
   bad stretch re-runs the checks and releases it when it passes. A rejected
   route stays rejected after an edit.

The flags come from the browser, so a hand-made request could leave them out;
reports and this queue are the backstop. Limits are the constants in
`QUALITY_LIMITS` (`src/lib/routeQuality.ts`); move a flag out of `KEY` there to
make it advisory.

### Removing a review, route or photo

Set its `status` to `rejected`: it disappears from the site, and you keep a
record. Delete the row only for something that must not be kept at all (for
example personal information); also delete its file under **Storage** for a
photo or GPX.

### Reports

Table Editor → `reports` → filter `status` equals `pending`. Each report says
which place or route (`target_type`, `target_slug`), what kind of problem and
the message. Fix or hide the item, then set the report to `approved` (dealt
with) or `rejected` (no action).

## Which "keys" exist

- **Your Supabase login** is the admin access. The dashboard is not limited by
  the website's rules, which is why moderation happens there.
- **The publishable key** is in the website's code on purpose. With it, anyone
  can only add new rows and read approved ones (the row-level security rules
  in `supabase/migrations/`); it cannot change or delete anything.
- **The service role key** (Settings → API) can do anything. Never put it in
  the site, a commit or a chat. It is not needed for moderation.

## Spam limits

`supabase/migrations/20261006000000_spam_limits.sql` limits how much one
connection can add per hour and per day, allows one review per place per
connection per day, caps each table's total per day, refuses web links in
reviews, captions and reports, and caps new files per storage bucket per hour.
Visitors see a plain message when they hit a limit.

- **Both are already applied to the live project.** For a new project, apply them once, in order: dashboard → **SQL Editor** →
  **New query** → paste `20261006000000_spam_limits.sql` → **Run**, then the
  same with `20261007000000_auto_publish.sql`.
- **Change the numbers:** SQL Editor →
  `update private.limits set per_hour = 5 where kind = 'reviews';`
- **Stop all new contributions of one kind in an emergency:**
  `update private.limits set total_per_day = 0 where kind = 'photos';`
  (set it back afterwards).
- **Clean up a burst:** Table Editor → sort by `created_at` → set the rows to
  `rejected` (or delete them).

The dashboard itself is never limited, so you can always add or fix things
there.
