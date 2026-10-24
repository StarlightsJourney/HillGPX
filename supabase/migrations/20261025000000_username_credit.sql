-- The credit on every contribution is now only ever "anonymous" or the
-- account username — no more free-text names.
--
-- reviews, photos, route_photos and reports never recorded who sent them:
-- author was typed text a rename could not follow and anyone could fake.
-- Each table gains the same owner stamp routes already have: user_id is set
-- from the session token on insert, never from client input, and the stamp
-- triggers also clamp the credit text — a signed-in contributor gets their
-- own profile username or nothing; a signed-out insert always lands
-- anonymous. That makes "username or anonymous" a database rule, not just a
-- form one, and anonymous credit still carries the owner stamp privately
-- (credit text is what is withheld), matching routes.
--
-- The rename trigger used to rewrite only routes.contributor. It now covers
-- every credit column, still only on rows that literally show the previous
-- username — a legacy hand-typed credit is left alone. Rows uploaded before
-- this migration keep user_id = null: there is no way to prove who sent
-- them, so a rename leaves them alone.
--
-- Apply in the Supabase dashboard (SQL editor → paste this file → Run), or
-- with `supabase db push`. Safe to rerun.
begin;

alter table public.reviews add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.photos add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.route_photos add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.reports add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists reviews_owner on public.reviews (user_id) where user_id is not null;
create index if not exists photos_owner on public.photos (user_id) where user_id is not null;
create index if not exists route_photos_owner on public.route_photos (user_id) where user_id is not null;

-- The only name an insert may carry: the caller's profile username, or null
-- when signed out (or when the account has no profile row yet).
create or replace function private.credit_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select username from public.profiles where id = auth.uid();
$$;

-- One before-insert stamp per table: set the owner from the session and
-- clamp the credit to username-or-null. A null credit stays null (the
-- anonymous choice); anything else is replaced by the caller's username, so
-- a crafted request cannot sign someone else's name.
create or replace function private.stamp_review_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  new.author := case when new.author is null then null else private.credit_name() end;
  return new;
end;
$$;
drop trigger if exists stamp_review_owner on public.reviews;
create trigger stamp_review_owner before insert on public.reviews
  for each row execute function private.stamp_review_owner();

create or replace function private.stamp_photo_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  new.author := case when new.author is null then null else private.credit_name() end;
  new.credit := case when new.credit is null then null else private.credit_name() end;
  return new;
end;
$$;
drop trigger if exists stamp_photo_owner on public.photos;
create trigger stamp_photo_owner before insert on public.photos
  for each row execute function private.stamp_photo_owner();

create or replace function private.stamp_route_photo_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  new.author := case when new.author is null then null else private.credit_name() end;
  return new;
end;
$$;
drop trigger if exists stamp_route_photo_owner on public.route_photos;
create trigger stamp_route_photo_owner before insert on public.route_photos
  for each row execute function private.stamp_route_photo_owner();

create or replace function private.stamp_report_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  new.author := case when new.author is null then null else private.credit_name() end;
  return new;
end;
$$;
drop trigger if exists stamp_report_owner on public.reports;
create trigger stamp_report_owner before insert on public.reports
  for each row execute function private.stamp_report_owner();

-- Routes get the same clamp: a signed-in publish is credited with the
-- profile username the server reads back, not whatever the request sent.
-- Signed-out inserts carry no flag worth trusting either — with no profile
-- behind the session the credit lands null (anonymous).
create or replace function private.stamp_route_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.anonymous then
    new.contributor := null;
  else
    new.contributor := private.credit_name();
  end if;
  new.user_id := auth.uid();
  new.visibility := 'public';
  return new;
end;
$$;

-- Belt and suspenders beside the triggers: the stamped id can only ever be
-- the caller's own.
drop policy if exists "contribute reviews" on public.reviews;
create policy "contribute reviews" on public.reviews for insert to anon, authenticated
  with check (status = 'approved' and (user_id is null or user_id = auth.uid()));
drop policy if exists "contribute photos" on public.photos;
create policy "contribute photos" on public.photos for insert to anon, authenticated
  with check (status = 'approved' and (user_id is null or user_id = auth.uid()));
drop policy if exists "contribute route photos" on public.route_photos;
create policy "contribute route photos" on public.route_photos for insert to anon, authenticated
  with check (status = 'approved' and (user_id is null or user_id = auth.uid()));
drop policy if exists "file reports" on public.reports;
create policy "file reports" on public.reports for insert to anon, authenticated
  with check (status = 'pending' and (user_id is null or user_id = auth.uid()));

-- A rename follows every credit the owner gave under the old name.
drop trigger if exists sync_route_contributor on public.profiles;
drop function if exists private.sync_route_contributor();
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
create trigger sync_credit_name after update of username on public.profiles
  for each row execute function private.sync_credit_name();

revoke all on function private.credit_name() from public, anon, authenticated;
revoke all on function private.stamp_review_owner() from public, anon, authenticated;
revoke all on function private.stamp_photo_owner() from public, anon, authenticated;
revoke all on function private.stamp_route_photo_owner() from public, anon, authenticated;
revoke all on function private.stamp_report_owner() from public, anon, authenticated;
revoke all on function private.sync_credit_name() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
