-- Accounts on Supabase Auth: public profiles, owned routes, avatars,
-- download counters and account deletion.
--
-- Signing in is optional — anonymous contribution stays exactly as before.
-- A signed-in visitor who publishes a route gets their auth.users id stamped
-- on the row (server-side trigger) unless they tick "Anonymous", which
-- withholds both the stamp and the public credit. Owners can list and delete
-- their own uploads; nobody else can. Profiles hold the public username and
-- avatar, nothing else — the account itself lives in auth.users.
--
-- Apply in the Supabase dashboard (SQL editor → paste this file → Run), or
-- with `supabase db push`. Dashboard settings the app needs alongside it:
--   * Authentication → Providers → Email → "Confirm email" OFF, so sign-up
--     returns a session straight away (the site has no "check your inbox"
--     flow).
--   * Authentication → Providers → Google → enabled, Client IDs = the same
--     OAuth client the site renders (VITE_GOOGLE_CLIENT_ID).
--   * Authentication → URL Configuration → Site URL = the site address.

-- ─── Profiles ────────────────────────────────────────────────────────────
-- The public handle behind an account. Usernames are public — they are the
-- contributor credit shown on routes — so anyone may read them; only the
-- owner may change theirs. Rows come from the sign-up trigger below and
-- disappear with the user, so there is no client insert/delete policy.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (username ~ '^[A-Za-z0-9_.-]{3,24}$'),
  avatar_path text,
  created_at timestamptz not null default now()
);
create unique index profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;
create policy "read profiles" on public.profiles for select to anon, authenticated using (true);
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
  base := lower(regexp_replace(coalesce(split_part(new.email, '@', 1), 'climber'), '[^a-z0-9_.-]', '', 'g'));
  base := rpad(substring(base from 1 for 20), 3, 'x');
  candidate := base;
  while exists (select 1 from public.profiles where lower(username) = lower(candidate)) loop
    suffix := suffix + 1;
    candidate := substring(base from 1 for greatest(1, 20 - char_length(suffix::text) - 1)) || '-' || suffix;
  end loop;
  insert into public.profiles (id, username) values (new.id, candidate);
  return new;
end;
$$;
create trigger new_profile after insert on auth.users
  for each row execute function private.new_profile();

-- ─── Owned routes ────────────────────────────────────────────────────────
-- user_id stamps the publisher's account so "My uploads" can list and the
-- owner can delete. The anonymous flag withholds both stamp and credit.
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
    new.user_id := null;
    new.contributor := null;
  else
    new.user_id := auth.uid();
  end if;
  new.visibility := 'public';
  return new;
end;
$$;
create trigger stamp_route_owner before insert on public.routes
  for each row execute function private.stamp_route_owner();

drop policy if exists "read approved routes" on public.routes;
create policy "read routes" on public.routes for select to anon, authenticated
  using ((status = 'approved' and visibility = 'public') or auth.uid() = user_id);

drop policy if exists "contribute routes" on public.routes;
create policy "contribute routes" on public.routes for insert to anon, authenticated
  with check (status = 'approved' and (user_id is null or user_id = auth.uid()));

create policy "delete own routes" on public.routes for delete to authenticated
  using (auth.uid() = user_id);

-- ─── Download counters ───────────────────────────────────────────────────
-- Community routes count on their own row (routes.downloads); every other
-- slug — the curated, committed routes — counts here.

create table public.route_downloads (
  slug text primary key check (char_length(slug) between 1 and 160),
  count integer not null default 0
);
alter table public.route_downloads enable row level security;
create policy "read downloads" on public.route_downloads for select to anon, authenticated using (true);

create or replace function public.record_route_download(p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.routes set downloads = downloads + 1 where slug = p_slug;
  if not found then
    insert into public.route_downloads (slug, count) values (p_slug, 1)
    on conflict (slug) do update set count = route_downloads.count + 1;
  end if;
end;
$$;
grant execute on function public.record_route_download(text) to anon, authenticated;

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

-- ─── Sign-in helpers ─────────────────────────────────────────────────────
-- Log in with a username instead of an email: resolves to the account's
-- email, which Supabase Auth then checks the password against. Like the
-- sign-in form itself it cannot hide that a username exists; it returns
-- only the email.
create or replace function public.email_for_username(p_username text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
  select u.email::text from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) = lower(trim(p_username))
  limit 1;
$$;
grant execute on function public.email_for_username(text) to anon, authenticated;

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
values ('avatars', 'avatars', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']);

create policy "upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "replace own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "remove own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
