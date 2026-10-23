-- Repair account setup on projects where the original accounts migration
-- was never applied or was only partially applied. Run this entire file in
-- the Supabase SQL Editor as postgres. Safe to rerun; existing profiles,
-- routes, ownership, counters and storage objects are preserved.
-- Prerequisites: community, reports/route photos, spam limits, auto publish.
-- Includes the account migration and contributor ownership fix together.
-- An outer transaction prevents a failed repair leaving half-installed setup.
begin;
create schema if not exists private;

-- Accounts on Supabase Auth: public profiles, owned routes, avatars,
-- download counters and account deletion.
--
-- Signing in is optional — anonymous contribution stays exactly as before.
-- A signed-in visitor who publishes a route gets their auth.users id stamped
-- on the row (server-side trigger), including when they tick "Anonymous",
-- which withholds public credit while keeping ownership. Owners can list and delete
-- their own uploads; nobody else can. Profiles hold the public username and
-- avatar, nothing else — the account itself lives in auth.users.
--
-- Apply in the Supabase dashboard (SQL editor → paste this file → Run), or
-- with `supabase db push`. Dashboard settings the app needs alongside it:
--   * Authentication → Providers → Email → "Confirm email" either way: ON
--     shows the sign-up modal's check-your-inbox screen (supabase-js picks
--     the session out of the link's URL hash), OFF signs in straight away.
--   * Authentication → Providers → Google → enabled, Client IDs = the same
--     OAuth client the site renders (VITE_GOOGLE_CLIENT_ID).
--   * Authentication → URL Configuration → Site URL = the site address,
--     which must also sit in Redirect URLs (sign-up, resend and
--     password-reset calls all pass redirect_to = VITE_SITE_URL, always
--     the canonical site). Reset links land as recovery sessions; the
--     site collects the new password in a dialog. Email bodies live in
--     Authentication → Emails → Templates.

-- ─── Profiles ────────────────────────────────────────────────────────────
-- The public handle behind an account. Usernames are public — they are the
-- contributor credit shown on routes — so anyone may read them; only the
-- owner may change theirs. Rows come from the sign-up trigger below and
-- disappear with the user, so there is no client insert/delete policy.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_.-]{3,24}$'),
  avatar_path text,
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;
drop policy if exists "read profiles" on public.profiles;
create policy "read profiles" on public.profiles for select to anon, authenticated using (true);
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- Every new auth user gets a profile. An email sign-up brings a chosen
-- username in the metadata — a clash raises the unique violation back to the
-- client ("that username is taken") rather than silently mangling it. A
-- Google sign-in has none, so a free handle is derived from the email's
-- local part, numbered until it fits.
create or replace function private.new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  base text;
  candidate text;
  suffix integer := 0;
begin
  if new.raw_user_meta_data ->> 'username' is not null then
    insert into public.profiles (id, username) values (new.id, new.raw_user_meta_data ->> 'username');
    return new;
  end if;
  base := lower(regexp_replace(coalesce(split_part(new.email, '@', 1), 'climber'), '[^a-zA-Z0-9_.-]', '', 'g'));
  base := substring(base from 1 for 20);
  if char_length(base) < 3 then base := rpad(base, 3, 'x'); end if;
  candidate := base;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    suffix := suffix + 1;
    candidate := substring(base from 1 for greatest(1, 20 - char_length(suffix::text) - 1)) || '-' || suffix;
  end loop;
  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end;
$$;
drop trigger if exists new_profile on auth.users;
create trigger new_profile after insert on auth.users
  for each row execute function private.new_profile();

-- ─── Owned routes ────────────────────────────────────────────────────────
-- user_id stamps the publisher's account so "My uploads" can list and the
-- owner can delete. The anonymous flag withholds only public credit.
-- visibility is the seam for a future private tier — only 'public' exists.
-- downloads counts this route's own saves; other slugs live in
-- route_downloads below.

alter table public.routes add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.routes add column if not exists anonymous boolean not null default false;
alter table public.routes add column if not exists visibility text not null default 'public' check (visibility = 'public');
alter table public.routes add column if not exists downloads integer not null default 0;
create index if not exists routes_owner on public.routes (user_id) where user_id is not null;

create or replace function private.stamp_route_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.anonymous then
    new.contributor := null;
  end if;
  new.user_id := auth.uid();
  new.visibility := 'public';
  return new;
end;
$$;
drop trigger if exists stamp_route_owner on public.routes;
create trigger stamp_route_owner before insert on public.routes
  for each row execute function private.stamp_route_owner();

drop policy if exists "read approved routes" on public.routes;
drop policy if exists "read routes" on public.routes;
create policy "read routes" on public.routes for select to anon, authenticated
  using ((status = 'approved' and visibility = 'public') or auth.uid() = user_id);

drop policy if exists "contribute routes" on public.routes;
create policy "contribute routes" on public.routes for insert to anon, authenticated
  with check (status = 'approved' and (user_id is null or user_id = auth.uid()));

drop policy if exists "delete own routes" on public.routes;
create policy "delete own routes" on public.routes for delete to authenticated
  using (auth.uid() = user_id);

-- ─── Download counters ───────────────────────────────────────────────────
-- Community routes count on their own row (routes.downloads); every other
-- curated, committed slug counts here, restricted by the allowlist below.

create table if not exists public.route_downloads (
  slug text primary key check (char_length(slug) between 1 and 160),
  count integer not null default 0
);
alter table public.route_downloads enable row level security;
drop policy if exists "read downloads" on public.route_downloads;
create policy "read downloads" on public.route_downloads for select to anon, authenticated using (true);

-- Both counters as one {slug: n} object for the dataset load.
create or replace function public.route_downloads()
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(json_object_agg(slug, n), '{}'::json) from (
    select slug, downloads as n from public.routes where downloads > 0
    union all
    select slug, count as n from public.route_downloads
  ) counts;
$$;
grant execute on function public.route_downloads() to anon, authenticated;

-- ─── Owner deletion ──────────────────────────────────────────────────────
-- Remove a route the caller published: the row, its stored GPX, rendered
-- card thumbnails, pinned photos and download counter all go together.
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
  delete from public.route_downloads where slug = route.slug;
  delete from public.routes where id = route.id;
end;
$$;
grant execute on function public.delete_community_route(text) to authenticated;

-- Delete the caller's own account: avatar files, the auth user, and with it
-- the profile (cascade). Routes they published stay public but lose the
-- owner link (user_id is set null by the foreign key); the contributor
-- credit text remains as published. The app re-checks the password before
-- calling this, the way the sign-in form does.
create or replace function public.delete_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = 'P0001';
  end if;
  delete from storage.objects where bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text;
  delete from auth.users where id = auth.uid();
end;
$$;
grant execute on function public.delete_user() to authenticated;

-- ─── Avatars ─────────────────────────────────────────────────────────────
-- One folder per account (named by the auth uid), public-read bucket.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "upload own avatar" on storage.objects;
create policy "upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "replace own avatar" on storage.objects;
create policy "replace own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "remove own avatar" on storage.objects;
create policy "remove own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Anonymous means "no public credit", not "no owner" — and renaming a
-- profile rewrites the credit on that owner's routes.
--
-- stamp_route_owner() used to clear user_id on anonymous publishes, which
-- made anonymous uploads impossible to manage (they never appeared in
-- My uploads and could not be deleted). It now keeps the stamp and only
-- withholds the credit: anonymous uploads are owned and deletable, the
-- public archive just reads "anonymous". Signed-out anonymous uploads stay
-- fully unattributed — there is no account to own them — and rows already
-- published with user_id = null keep it.
--
-- routes.contributor is a snapshot of the publisher's username taken at
-- upload time; a rename used to leave the old name on every published
-- route. The sync trigger rewrites it — but only on rows that still show
-- the previous name, so a hand-typed custom credit is never overwritten.
--
-- Apply in the Supabase dashboard (SQL editor → paste this file → Run), or
-- with `supabase db push`.



create or replace function private.sync_route_contributor()
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
  end if;
  return new;
end;
$$;

drop trigger if exists sync_route_contributor on public.profiles;
create trigger sync_route_contributor after update of username on public.profiles
  for each row execute function private.sync_route_contributor();

-- Auth users created before the accounts migration have no profile. Give each
-- one a valid, unique handle; never infer ownership of unattributed routes.
do $$
declare
  account record;
  base text;
  candidate text;
  suffix integer;
begin
  for account in
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
    order by u.created_at, u.id
  loop
    base := account.raw_user_meta_data ->> 'username';
    if base is null or base !~ '^[A-Za-z0-9_.-]{3,24}$' then
      base := substring(lower(regexp_replace(coalesce(split_part(account.email, '@', 1), 'climber'), '[^a-zA-Z0-9_.-]', '', 'g')) from 1 for 20);
      if char_length(base) < 3 then base := rpad(base, 3, 'x'); end if;
    end if;
    candidate := base;
    suffix := 0;
    while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
      suffix := suffix + 1;
      candidate := substring(base from 1 for greatest(1, 23 - char_length(suffix::text))) || '-' || suffix;
    end loop;
    insert into public.profiles (id, username) values (account.id, candidate);
  end loop;
end;
$$;

drop function if exists public.email_for_username(text);

-- Only committed routes may get counters outside public.routes. Keep this
-- allowlist in sync with public/data/routes.json through future migrations.
create table if not exists private.curated_route_slugs (
  slug text primary key check (slug ~ '^[a-z0-9-]{3,120}$')
);
revoke all on private.curated_route_slugs from public, anon, authenticated;
insert into private.curated_route_slugs (slug) values
  ('hong-kong-trail-section-2'),
  ('hong-kong-trail-section-3'),
  ('hong-kong-trail-section-4'),
  ('kluang-district-trail-run'),
  ('southern-ridges-walk'),
  ('utsg-60km-final-revised')
on conflict (slug) do nothing;

-- Separate quotas: download tracking must not spend a contributor's upload
-- allowance. These apply to the salted IP log already retained for one day.
insert into private.limits (kind, per_hour, per_day, total_per_day)
values ('route_downloads', 30, 200, 10000)
on conflict (kind) do nothing;

create or replace function public.record_route_download(p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller text;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,120}$' then return; end if;
  if not exists (
    select 1 from public.routes where slug = p_slug and status = 'approved' and visibility = 'public'
  ) and not exists (
    select 1 from private.curated_route_slugs where slug = p_slug
  ) then return; end if;

  -- Unknown callers cannot bypass quotas (dashboard/server jobs need not count).
  caller := private.caller_hash();
  if caller is null then return; end if;
  -- Serialize quota-check + increment; drop concurrent tracking calls instead
  -- of queuing them. This is best-effort analytics, never a download gate.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('hillgpx:route-download', 0)) then return; end if;
  if exists (
    select 1 from private.contribution_log
    where kind = 'route_downloads' and ip_hash = caller and target = p_slug
      and created_at > now() - interval '10 minutes'
  ) then return; end if;
  begin
    perform private.check_contribution('route_downloads', p_slug);
  exception when sqlstate 'P0001' then
    return;
  end;

  update public.routes
  set downloads = least(downloads::bigint + 1, 2147483647)::integer
  where slug = p_slug and status = 'approved' and visibility = 'public';
  if not found and exists (select 1 from private.curated_route_slugs where slug = p_slug) then
    insert into public.route_downloads (slug, count) values (p_slug, 1)
    on conflict (slug) do update
      set count = least(public.route_downloads.count::bigint + 1, 2147483647)::integer;
  end if;
end;
$$;

-- A GRANT does not remove PostgreSQL's default EXECUTE grant to PUBLIC.
-- Revoke inherited/default access before granting precisely the intended roles.
revoke all on function public.record_route_download(text) from public, anon, authenticated;
grant execute on function public.record_route_download(text) to anon, authenticated;
revoke all on function public.route_downloads() from public, anon, authenticated;
grant execute on function public.route_downloads() to anon, authenticated;
revoke all on function public.delete_community_route(text) from public, anon, authenticated;
grant execute on function public.delete_community_route(text) to authenticated;
revoke all on function public.delete_user() from public, anon, authenticated;
grant execute on function public.delete_user() to authenticated;

-- Triggers run without exposing their functions to client roles. Retain the
-- existing grants on helpers called by storage RLS (bucket_has_room).
revoke all on function private.new_profile() from public, anon, authenticated;
revoke all on function private.stamp_route_owner() from public, anon, authenticated;
revoke all on function private.sync_route_contributor() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
