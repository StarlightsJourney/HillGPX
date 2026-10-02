-- Reports (wrong details, hazards, closures), photos pinned along routes, and
-- larger GPX uploads (stored gzipped) with a thumbnail rendered at publish.

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('venue', 'route')),
  target_slug text not null check (char_length(target_slug) between 1 and 160),
  kind text not null check (kind in ('wrong_details', 'hazard', 'closed', 'photo', 'other')),
  message text not null check (char_length(message) between 3 and 1000),
  author text check (char_length(author) <= 60),
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
-- Anyone may file a report; only maintainers (dashboard) read them.
create policy "file reports" on public.reports for insert to anon, authenticated with check (status = 'pending');

create table public.route_photos (
  id uuid primary key default gen_random_uuid(),
  route_slug text not null check (char_length(route_slug) between 1 and 160),
  lng double precision not null check (lng between -180 and 180),
  lat double precision not null check (lat between -90 and 90),
  kind text not null check (kind in ('photo', 'hazard')),
  caption text check (char_length(caption) <= 280),
  storage_path text not null unique check (storage_path ~ '^route-[a-z0-9-]+/[a-z0-9-]+\.jpg$'),
  author text check (char_length(author) <= 60),
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now()
);
create index route_photos_route on public.route_photos (route_slug) where status = 'approved';
alter table public.route_photos enable row level security;
create policy "read approved route photos" on public.route_photos for select to anon, authenticated using (status = 'approved');
create policy "contribute route photos" on public.route_photos for insert to anon, authenticated with check (status = 'pending');

-- Route photos share the photos bucket under a route- prefix.
drop policy "upload photos" on storage.objects;
create policy "upload photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos' and name ~ '^[a-z0-9-]+/[a-z0-9-]+\.(jpg|jpeg|png|webp)$');

-- Long ultra GPX files (200 km, 50 MB raw) are gzipped in the browser first.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['application/gpx+xml', 'application/xml', 'text/xml', 'application/gzip']
where id = 'gpx';
drop policy "upload gpx" on storage.objects;
create policy "upload gpx" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'gpx' and name ~ '^[a-z0-9-]+\.gpx(\.gz)?$');
alter table public.routes drop constraint routes_gpx_path_check;
alter table public.routes add constraint routes_gpx_path_check check (gpx_path ~ '^[a-z0-9-]+\.gpx(\.gz)?$');

-- Card thumbnails for community routes, rendered in the browser at publish time.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('route-thumbs', 'route-thumbs', true, 1048576, array['image/jpeg']);
create policy "upload route thumbs" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'route-thumbs' and name ~ '^[a-z0-9-]+\.jpg$');

-- Uploads keep the file's own elevation; Singapore files without any use the bundled DEM.
alter table public.routes drop constraint routes_elevation_source_check;
alter table public.routes add constraint routes_elevation_source_check check (elevation_source in ('gps', 'terrain', 'dem'));
