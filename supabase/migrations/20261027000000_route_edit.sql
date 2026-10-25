-- Owner edits to a published route. Uploaders can rename a route, move its
-- credit between their username and anonymous, and trim the ends off the
-- track after it is already live.
--
-- Editing goes through one security-definer function rather than an update
-- policy: only the columns an owner may touch are writable, so status,
-- user_id and the upload date can never be changed by a crafted request.
-- The ownership check is the same one delete_community_route makes.
--
-- Apply in the Supabase dashboard (SQL editor → paste this file → Run), or
-- with `supabase db push`. Safe to rerun.
begin;

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
  p_gpx_path text default null
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
    delete from storage.objects where bucket_id = 'gpx' and name = route.gpx_path;
    -- Card thumbnails picture the old line; the app re-renders them on demand.
    delete from storage.objects where bucket_id = 'route-thumbs' and name like route.slug || '-%.jpg';
  end if;
end;
$$;

revoke all on function public.edit_community_route(text, text, boolean, jsonb, real, real, real, text, text[], text) from public, anon, authenticated;
grant execute on function public.edit_community_route(text, text, boolean, jsonb, real, real, real, text, text[], text) to authenticated;

notify pgrst, 'reload schema';
commit;
