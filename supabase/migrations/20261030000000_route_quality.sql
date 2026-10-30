-- Route quality checks: poor uploads are held, visible only to the account
-- that uploaded them, until they pass the checks or a maintainer approves them.
--
-- The browser assesses the raw track (src/lib/routeQuality.ts) and sends the
-- flags with the insert. A trigger, not the client, turns them into a status:
-- any `severity: key` flag stores the route as 'pending' (held), otherwise
-- 'approved'. The existing "read routes" policy already lets an owner read
-- their own rows and the public read approved ones only, so a held route is
-- invisible to everyone else. Guests (no session) have no way to read a held
-- row back, so a guest insert with a key flag is refused outright.
--
-- Review: Table Editor -> routes -> filter status = 'pending'. Set 'approved'
-- to release a route, 'rejected' to close it. quality_flags says why it was held.
--
-- Trust model: the flags come from the client, like the other upload rules.
-- A hand-made request can leave them out. Reports and dashboard review are the
-- backstop; a server-side recompute from the stored GPX can replace this later.
--
-- Apply in the Supabase dashboard (SQL editor -> paste this file -> Run), or
-- with `supabase db push`. Safe to rerun.
begin;

alter table public.routes add column if not exists quality_flags jsonb not null default '[]'
  check (jsonb_typeof(quality_flags) = 'array' and jsonb_array_length(quality_flags) <= 20);

create or replace function private.assess_route_quality()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  held boolean;
begin
  held := exists (
    select 1 from jsonb_array_elements(new.quality_flags) f
    where jsonb_typeof(f) = 'object' and f ->> 'severity' = 'key'
  );
  if held and auth.uid() is null then
    raise exception 'This track failed the quality checks. Sign in to save it and fix it.' using errcode = 'P0001';
  end if;
  -- The client never chooses a status: it is decided here, from the flags.
  new.status := case when held then 'pending' else 'approved' end;
  return new;
end;
$$;
-- Named to fire after stamp_route_owner (BEFORE triggers run alphabetically).
drop trigger if exists zz_assess_route_quality on public.routes;
create trigger zz_assess_route_quality before insert on public.routes
  for each row execute function private.assess_route_quality();

-- The trigger overwrites the status, so the policy only has to allow both
-- values a row can legitimately end up with.
drop policy if exists "contribute routes" on public.routes;
create policy "contribute routes" on public.routes for insert to anon, authenticated
  with check (status in ('approved', 'pending') and (user_id is null or user_id = auth.uid()));

-- Owner edits re-assess a trimmed track (see edit_community_route).
drop function if exists public.edit_community_route(text, text, boolean, jsonb, real, real, real, text, text[], text);

create or replace function public.edit_community_route(
  p_slug text,
  p_name text default null,
  p_anonymous boolean default null,
  p_points jsonb default null,
  p_distance_m real default null,
  p_gain_m real default null,
  p_loss_m real default null,
  p_geom_hash text default null,
  p_venue_slugs text[] default null,
  p_gpx_path text default null,
  p_quality_flags jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  route public.routes%rowtype;
  w real;
  s real;
  e real;
  n real;
begin
  select * into route from public.routes where slug = p_slug and user_id = auth.uid();
  if not found then
    raise exception 'No such route on your account.' using errcode = 'P0001';
  end if;

  -- Rename: slug stays put, so links and saved bookmarks keep working.
  if p_name is not null then
    if char_length(trim(p_name)) = 0 then
      raise exception 'A route needs a name.' using errcode = 'P0001';
    end if;
    update public.routes set name = left(trim(p_name), 120) where id = route.id;
  end if;

  -- Credit: the only two values a route may carry, same rule as at publish —
  -- the caller's own profile username, or null for anonymous.
  if p_anonymous is not null then
    update public.routes set
      anonymous = p_anonymous,
      contributor = case when p_anonymous then null else private.credit_name() end
    where id = route.id;
  end if;

  -- Trim: the kept slice, its stats, bounding box, dedupe fingerprint and the
  -- stored file all move together. The caller uploads the regenerated file
  -- first and passes its new path; the old object is deleted here, so the
  -- cut-off ends can no longer be downloaded.
  if p_points is not null then
    if p_distance_m is null or p_gain_m is null or p_loss_m is null
       or p_geom_hash is null or p_gpx_path is null then
      raise exception 'A trimmed track needs its stats, fingerprint and file.' using errcode = 'P0001';
    end if;
    if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) < 2 then
      raise exception 'A route needs at least two points.' using errcode = 'P0001';
    end if;
    if p_gpx_path !~ '^[a-z0-9-]+\.gpx(\.gz)?$' or p_gpx_path = route.gpx_path then
      raise exception 'Bad replacement file path.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'gpx' and name = p_gpx_path) then
      raise exception 'The replacement file is not uploaded yet.' using errcode = 'P0001';
    end if;
    select min((pt ->> 0)::real), min((pt ->> 1)::real),
           max((pt ->> 0)::real), max((pt ->> 1)::real)
      into w, s, e, n
      from jsonb_array_elements(p_points) pt;
    update public.routes set
      points = p_points,
      distance_m = p_distance_m,
      gain_m = p_gain_m,
      loss_m = p_loss_m,
      west = w,
      south = s,
      east = e,
      north = n,
      geom_hash = p_geom_hash,
      venue_slugs = coalesce(p_venue_slugs, '{}'),
      gpx_path = p_gpx_path
    where id = route.id;
    -- Re-assess the new track: it may now pass (a held route goes live) or
    -- fail (a published route is held). A maintainer's rejection stays.
    if p_quality_flags is not null then
      if jsonb_typeof(p_quality_flags) <> 'array' or jsonb_array_length(p_quality_flags) > 20 then
        raise exception 'Bad quality flags.' using errcode = 'P0001';
      end if;
      update public.routes set
        quality_flags = p_quality_flags,
        status = case
          when status = 'rejected' then status
          when exists (select 1 from jsonb_array_elements(p_quality_flags) f where f ->> 'severity' = 'key') then 'pending'
          else 'approved'
        end
      where id = route.id;
    end if;
    delete from storage.objects where bucket_id = 'gpx' and name = route.gpx_path;
    -- Card thumbnails picture the old line; the app re-renders them on demand.
    delete from storage.objects where bucket_id = 'route-thumbs' and name like route.slug || '-%.jpg';
  end if;
end;
$$;

revoke all on function public.edit_community_route(text, text, boolean, jsonb, real, real, real, text, text[], text, jsonb) from public, anon, authenticated;
grant execute on function public.edit_community_route(text, text, boolean, jsonb, real, real, real, text, text[], text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
