-- HillGPX community storage: routes (GPX), photos and reviews.
--
-- Anyone can contribute without an account (the browser uses the public anon
-- key). Row-level security limits anonymous users to inserting new rows and
-- reading approved ones; nobody can edit or delete through the API. Routes and
-- reviews are published immediately, photos wait for a maintainer to approve
-- them in the Supabase dashboard (set status = 'approved').

create type public.moderation_status as enum ('pending', 'approved', 'rejected');
create type public.route_activity as enum ('run', 'trail', 'cycle');

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,120}$'),
  name text not null check (char_length(name) between 1 and 120),
  activity public.route_activity not null,
  recorded_at timestamptz,
  distance_m real not null check (distance_m > 0),
  gain_m real not null check (gain_m >= 0),
  loss_m real not null check (loss_m >= 0),
  elevation_source text not null check (elevation_source in ('gps', 'terrain')),
  -- Fingerprint of the simplified track, so the same GPX cannot be added twice.
  geom_hash text not null unique check (char_length(geom_hash) between 8 and 64),
  west real not null, south real not null, east real not null, north real not null,
  venue_slugs text[] not null default '{}' check (cardinality(venue_slugs) <= 200),
  -- Simplified [lng, lat, ele] points for drawing; the original GPX is in storage.
  points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 2 and 5000),
  gpx_path text not null check (gpx_path ~ '^[a-z0-9-]+\.gpx$'),
  contributor text check (char_length(contributor) <= 60),
  licence text not null default 'CC BY 4.0' check (char_length(licence) <= 60),
  status public.moderation_status not null default 'approved',
  created_at timestamptz not null default now()
);
create index routes_bbox on public.routes (west, east, south, north);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  venue_slug text not null check (char_length(venue_slug) between 1 and 160),
  storage_path text not null unique check (storage_path ~ '^[a-z0-9-]+/[a-z0-9-]+\.(jpg|jpeg|png|webp)$'),
  credit text check (char_length(credit) <= 120),
  licence text not null check (char_length(licence) <= 60),
  author text check (char_length(author) <= 60),
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now()
);
create index photos_venue on public.photos (venue_slug) where status = 'approved';

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  venue_slug text not null check (char_length(venue_slug) between 1 and 160),
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 1000),
  author text check (char_length(author) <= 60),
  status public.moderation_status not null default 'approved',
  created_at timestamptz not null default now()
);
create index reviews_venue on public.reviews (venue_slug) where status = 'approved';

alter table public.routes enable row level security;
alter table public.photos enable row level security;
alter table public.reviews enable row level security;

-- Read: approved rows only.
create policy "read approved routes" on public.routes for select to anon, authenticated using (status = 'approved');
create policy "read approved photos" on public.photos for select to anon, authenticated using (status = 'approved');
create policy "read approved reviews" on public.reviews for select to anon, authenticated using (status = 'approved');

-- Write: insert only, and only with the default moderation status.
create policy "contribute routes" on public.routes for insert to anon, authenticated with check (status = 'approved');
create policy "contribute photos" on public.photos for insert to anon, authenticated with check (status = 'pending');
create policy "contribute reviews" on public.reviews for insert to anon, authenticated with check (status = 'approved');

-- Community counters for the coverage pill, without exposing pending rows.
create or replace function public.community_stats()
returns json
language sql
stable
-- Invoker rights: the select policies above already limit counts to approved rows.
security invoker
set search_path = ''
as $$
  select json_build_object(
    'routes', (select count(*) from public.routes where status = 'approved'),
    'photos', (select count(*) from public.photos where status = 'approved'),
    'reviews', (select count(*) from public.reviews where status = 'approved'),
    'routeVenues', (select coalesce(array_agg(distinct v), '{}') from public.routes r, unnest(r.venue_slugs) v where r.status = 'approved'),
    'photoVenues', (select coalesce(array_agg(distinct venue_slug), '{}') from public.photos where status = 'approved')
  );
$$;
grant execute on function public.community_stats() to anon, authenticated;

-- Storage: public-read buckets, anonymous upload of new objects only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('gpx', 'gpx', true, 5242880, array['application/gpx+xml', 'application/xml', 'text/xml']),
  ('photos', 'photos', true, 8388608, array['image/jpeg', 'image/png', 'image/webp']);

create policy "upload gpx" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'gpx' and name ~ '^[a-z0-9-]+\.gpx$');
create policy "upload photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos' and name ~ '^[a-z0-9-]+/[a-z0-9-]+\.(jpg|jpeg|png|webp)$');
