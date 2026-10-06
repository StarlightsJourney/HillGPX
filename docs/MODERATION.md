# Moderating hillGPX

Everything people add goes straight from their browser to the project's
Supabase database. There is no admin page on the site: moderation happens in
the Supabase dashboard, where you are signed in as the project owner.

## Where people add things

| What | Where on the site | Goes live |
| --- | --- | --- |
| GPX route | **+ Add a GPX** in the header (or "Upload a GPX" on a place page) | Straight away |
| Photos of a place | Place page → **Add photos** on the photo grid | After you approve |
| Review and rating | Place page → **Reviews** (or the stars under the height) | Straight away |
| Photo or hazard on a route | Open a route → **More details** → **Photo or hazard** | After you approve |
| Report a problem | Place page or route (i) → **Report an issue** | Only you see it |

## The dashboard

1. Sign in at [supabase.com](https://supabase.com) with the account that owns
   the project and open **hillgpx**.
2. Open **Table Editor**. Each kind of contribution is a table: `routes`,
   `photos`, `route_photos`, `reviews`, `reports`.
3. Every row has a `status`: `pending`, `approved` or `rejected`. The site only
   ever shows `approved` rows.

### Approving photos

1. Table Editor → `photos` (or `route_photos`) → filter `status` equals
   `pending`.
2. To see the picture, open **Storage** → `photos` bucket → the path in the
   row's `storage_path` column.
3. Back in the table, set `status` to `approved` (it appears on the site
   within a minute) or `rejected`.

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

- **Apply it once:** dashboard → **SQL Editor** → **New query** → paste the
  whole file → **Run**.
- **Change the numbers:** SQL Editor →
  `update private.limits set per_hour = 5 where kind = 'reviews';`
- **Stop all new contributions of one kind in an emergency:**
  `update private.limits set total_per_day = 0 where kind = 'photos';`
  (set it back afterwards).
- **Clean up a burst:** Table Editor → sort by `created_at` → set the rows to
  `rejected` (or delete them).

The dashboard itself is never limited, so you can always add or fix things
there.
