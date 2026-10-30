-- Route reviews: a star rating and a comment on a route, one per account.
--
-- Anyone can read them; only signed-in accounts can write. They publish at
-- once and are flagged afterwards, like the rest of the archive: three
-- different reporters hide one (status 'pending'), and moderators hide,
-- restore or delete rows in the dashboard (docs/MODERATION.md). A hidden
-- review stays locked for its author: it still blocks a second post, and only
-- the row being deleted frees the route for a new one.
--
-- A separate table from reviews: place reviews take guests and need a venue
-- slug, so sharing it would mix two sets of access rules. route_slug has no
-- foreign key because committed routes exist only in static files. A slug
-- never changes, so reviews survive a route's rename or trim.
--
-- user_id must never reach the API, or "anonymous" would mean nothing, so this
-- table is opened by column: no client role can read, filter on or write
-- user_id or status. "Which one is mine" goes through my_route_review().
-- Clients name their columns in the select; `select=*` is refused.
--
-- Apply in the Supabase dashboard (SQL editor -> paste this file -> Run), or
-- with `supabase db push`. Needs the spam limits, auto publish and username
-- credit migrations first. Safe to rerun.
begin;

create table if not exists public.route_reviews (
  id uuid primary key default gen_random_uuid(),
  route_slug text not null check (char_length(route_slug) between 1 and 160),
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (char_length(btrim(comment, E' \t\r\n')) between 1 and 1000),
  -- Null means anonymous.
  author text check (char_length(author) <= 60),
  -- Set null with the account: the review stays with its credit text.
  user_id uuid references auth.users (id) on delete set null,
  status public.moderation_status not null default 'approved',
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
-- Covers hidden rows too, so a hidden review cannot be replaced by a new post.
create unique index if not exists route_reviews_one_per_user on public.route_reviews (route_slug, user_id) where user_id is not null;
create index if not exists route_reviews_route on public.route_reviews (route_slug) where status = 'approved';
create index if not exists route_reviews_owner on public.route_reviews (user_id) where user_id is not null;

alter table public.route_reviews enable row level security;

drop policy if exists "read approved route reviews" on public.route_reviews;
create policy "read approved route reviews" on public.route_reviews for select to anon, authenticated
  using (status = 'approved');
drop policy if exists "contribute route reviews" on public.route_reviews;
create policy "contribute route reviews" on public.route_reviews for insert to authenticated
  with check (status = 'approved' and user_id = auth.uid());

-- Supabase grants every new public table to the API roles: take that back,
-- then open only the columns each role needs. There are no update or delete
-- grants; the RPCs below are the only way to change a row.
revoke all on public.route_reviews from public, anon, authenticated;
grant select (id, route_slug, rating, comment, author, created_at, edited_at) on public.route_reviews to anon, authenticated;
grant insert (id, route_slug, rating, comment, author) on public.route_reviews to authenticated;

-- Set the owner from the session and clamp the credit, as stamp_review_owner
-- does. A held route shows only to its owner, so it takes no reviews.
create or replace function private.stamp_route_review_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.routes where slug = new.route_slug and status <> 'approved') then
    raise exception 'This route is not open for reviews.' using errcode = 'P0001';
  end if;
  new.user_id := auth.uid();
  new.author := case when new.author is null then null else private.credit_name() end;
  new.comment := btrim(new.comment, E' \t\r\n');
  return new;
end;
$$;
drop trigger if exists stamp_route_review_owner on public.route_reviews;
create trigger stamp_route_review_owner before insert on public.route_reviews
  for each row execute function private.stamp_route_review_owner();

-- Spam limits: no links, plus hourly, daily and total caps at the same numbers
-- as place reviews. The unique index stands in for the per-place daily rule.
insert into private.limits (kind, per_hour, per_day, total_per_day) values ('route_reviews', 10, 30, 1000)
on conflict (kind) do nothing;
drop trigger if exists guard_contribution on public.route_reviews;
create trigger guard_contribution before insert on public.route_reviews
  for each row execute function private.guard_contribution();

-- The caller's own review of a route, hidden or not: the public read cannot
-- show an author their hidden review.
create or replace function public.my_route_review(p_route_slug text)
returns table (id uuid, route_slug text, rating smallint, comment text, author text, status public.moderation_status, created_at timestamptz, edited_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.route_slug, r.rating, r.comment, r.author, r.status, r.created_at, r.edited_at
  from public.route_reviews r
  where r.route_slug = p_route_slug and r.user_id = auth.uid();
$$;

-- The guard runs on insert only, so an edit applies the no-links rule itself,
-- and clamps the credit as the insert stamp does.
create or replace function public.edit_route_review(p_id uuid, p_rating integer, p_comment text, p_author text)
returns table (id uuid, route_slug text, rating smallint, comment text, author text, status public.moderation_status, created_at timestamptz, edited_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.moderation_status;
  next_comment text := btrim(coalesce(p_comment, ''), E' \t\r\n');
begin
  select r.status into current_status from public.route_reviews r where r.id = p_id and r.user_id = auth.uid() for update;
  if not found then
    raise exception 'No such review on your account.' using errcode = 'P0001';
  end if;
  if current_status <> 'approved' then
    raise exception 'This review was hidden by a moderator, so it cannot be changed.' using errcode = 'P0001';
  end if;
  if p_rating is null or p_rating not between 1 and 5 or char_length(next_comment) not between 1 and 1000 then
    raise exception 'A review needs a rating from 1 to 5 and a comment of up to 1,000 characters.' using errcode = 'P0001';
  end if;
  if private.has_link(next_comment) then
    raise exception 'Please leave out web links. Describe it in words instead.' using errcode = 'P0001';
  end if;
  update public.route_reviews r set
    rating = p_rating,
    comment = next_comment,
    author = case when nullif(p_author, '') is null then null else private.credit_name() end,
    edited_at = now()
  where r.id = p_id;
  return query
    select r.id, r.route_slug, r.rating, r.comment, r.author, r.status, r.created_at, r.edited_at
    from public.route_reviews r where r.id = p_id;
end;
$$;

create or replace function public.delete_route_review(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_status public.moderation_status;
begin
  select r.status into current_status from public.route_reviews r where r.id = p_id and r.user_id = auth.uid() for update;
  if not found then
    raise exception 'No such review on your account.' using errcode = 'P0001';
  end if;
  if current_status <> 'approved' then
    raise exception 'This review was hidden by a moderator, so it cannot be changed.' using errcode = 'P0001';
  end if;
  delete from public.route_reviews where id = p_id;
end;
$$;

-- Reports can point at a route review, and three distinct reporters hide it.
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('venue', 'route', 'photo', 'route_photo', 'review', 'route_review'));

create or replace function private.hide_reported()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  reporters integer;
  threshold integer := coalesce((select per_day from private.limits where kind = 'hide_after_reports'), 3);
begin
  if new.target_type not in ('photo', 'route_photo', 'review', 'route_review') then
    return null;
  end if;
  begin
    target := new.target_slug::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  select count(distinct coalesce(reporter_hash, id::text)) into reporters
  from public.reports
  where target_type = new.target_type and target_slug = new.target_slug and status = 'pending'
    and created_at > now() - interval '30 days';
  if reporters >= threshold then
    if new.target_type = 'photo' then
      update public.photos set status = 'pending' where id = target and status = 'approved';
    elsif new.target_type = 'route_photo' then
      update public.route_photos set status = 'pending' where id = target and status = 'approved';
    elsif new.target_type = 'route_review' then
      update public.route_reviews set status = 'pending' where id = target and status = 'approved';
    else
      update public.reviews set status = 'pending' where id = target and status = 'approved';
    end if;
  end if;
  return null;
end;
$$;

-- A rename follows every credit the owner gave under the old name.
create or replace function private.sync_credit_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.username is distinct from old.username then
    update public.routes
    set contributor = new.username
    where user_id = new.id and contributor = old.username;
    update public.reviews
    set author = new.username
    where user_id = new.id and author = old.username;
    update public.route_reviews
    set author = new.username
    where user_id = new.id and author = old.username;
    update public.photos
    set author = new.username,
        credit = case when credit = old.username then new.username else credit end
    where user_id = new.id and (author = old.username or credit = old.username);
    update public.route_photos
    set author = new.username
    where user_id = new.id and author = old.username;
    update public.reports
    set author = new.username
    where user_id = new.id and author = old.username;
  end if;
  return new;
end;
$$;

-- A deleted route takes its reviews with it.
create or replace function public.delete_community_route(p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  route public.routes%rowtype;
begin
  select * into route from public.routes where slug = p_slug and user_id = auth.uid();
  if not found then
    raise exception 'No such route on your account.' using errcode = 'P0001';
  end if;
  delete from storage.objects where bucket_id = 'gpx' and name = route.gpx_path;
  delete from storage.objects where bucket_id = 'route-thumbs' and name like route.slug || '-%.jpg';
  delete from public.route_photos where route_slug = route.slug;
  delete from public.route_reviews where route_slug = route.slug;
  delete from public.route_downloads where slug = route.slug;
  delete from public.routes where id = route.id;
end;
$$;

-- A GRANT does not remove PostgreSQL's default EXECUTE grant to PUBLIC.
revoke all on function private.stamp_route_review_owner() from public, anon, authenticated;
revoke all on function public.my_route_review(text) from public, anon, authenticated;
grant execute on function public.my_route_review(text) to authenticated;
revoke all on function public.edit_route_review(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.edit_route_review(uuid, integer, text, text) to authenticated;
revoke all on function public.delete_route_review(uuid) from public, anon, authenticated;
grant execute on function public.delete_route_review(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
