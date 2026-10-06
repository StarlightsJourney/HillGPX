-- Spam protection for anonymous contributions.
--
-- Anyone can add routes, photos, reviews and reports without an account, so
-- the database limits how much one connection can add and how much can arrive
-- in total, and turns away link spam. Nothing here needs a paid plan or an
-- outside service.
--
-- * Per connection: each insert records a salted, one-way hash of the caller's
--   network address (never the address itself) in a private table that only
--   keeps the last day. Too many inserts from one hash in an hour or a day is
--   refused with a plain message the site shows as it is.
-- * Per place: one review per connection per place per day.
-- * In total: a daily ceiling per table, so a flood spread over many
--   addresses still stops at a size a volunteer can clean up.
-- * Links: reviews, captions and reports may not contain web links.
-- * Storage: hourly ceilings on new files per bucket, so files uploaded
--   without a matching row cannot fill the free storage quota.
--
-- Apply in the Supabase dashboard (SQL editor → paste this file → Run), or
-- with `supabase db push`. Change the numbers in private.limits below.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.settings (
  key text primary key,
  value text not null
);
-- A random salt: the stored hashes cannot be reversed into addresses, or
-- matched against hashes from anywhere else.
insert into private.settings (key, value)
values ('ip_salt', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create table private.limits (
  kind text primary key,
  per_hour integer not null,
  per_day integer not null,
  total_per_day integer not null
);
insert into private.limits (kind, per_hour, per_day, total_per_day) values
  ('routes', 10, 30, 300),
  ('photos', 20, 60, 1000),
  ('route_photos', 20, 60, 1000),
  ('reviews', 10, 30, 1000),
  ('reports', 10, 30, 500);

create table private.contribution_log (
  ip_hash text not null,
  kind text not null,
  target text,
  created_at timestamptz not null default now()
);
create index contribution_log_recent on private.contribution_log (kind, ip_hash, created_at);
create index contribution_log_age on private.contribution_log (created_at);

-- The caller's address as the API gateway passed it on (first hop of
-- x-forwarded-for). Empty for the dashboard and server-side jobs, which are
-- not limited.
create or replace function private.caller_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select nullif(trim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1)), '');
$$;

create or replace function private.check_contribution(p_kind text, p_target text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ip text := private.caller_ip();
  hash text;
  lim private.limits%rowtype;
begin
  -- Keep only a day of history.
  delete from private.contribution_log where created_at < now() - interval '1 day';

  select * into lim from private.limits where kind = p_kind;
  if not found then
    return;
  end if;

  if (select count(*) from private.contribution_log where kind = p_kind) >= lim.total_per_day then
    raise exception 'hillGPX is taking a breather: too many contributions today. Please try again tomorrow.'
      using errcode = 'P0001';
  end if;

  if ip is null then
    return;
  end if;
  hash := encode(extensions.digest((select value from private.settings where key = 'ip_salt') || ip, 'sha256'), 'hex');

  if (select count(*) from private.contribution_log
      where kind = p_kind and ip_hash = hash and created_at > now() - interval '1 hour') >= lim.per_hour
     or (select count(*) from private.contribution_log where kind = p_kind and ip_hash = hash) >= lim.per_day then
    raise exception 'You have added a lot in a short time. Please wait a while and try again.'
      using errcode = 'P0001';
  end if;

  if p_kind = 'reviews' and p_target is not null and exists (
    select 1 from private.contribution_log where kind = 'reviews' and ip_hash = hash and target = p_target
  ) then
    raise exception 'You have already reviewed this place today.'
      using errcode = 'P0001';
  end if;

  insert into private.contribution_log (ip_hash, kind, target) values (hash, p_kind, p_target);
end;
$$;

-- No links in free text: they are the whole point of most spam.
create or replace function private.has_link(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_text, '') ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|net|org|io|xyz|ru|cn|top|info|biz|shop|site|online)\M)';
$$;

create or replace function private.guard_contribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Read fields by name through JSON: each table has different columns, and
  -- PL/pgSQL fails on `new.comment` for a table without one.
  row_json jsonb := to_jsonb(new);
begin
  if private.has_link(concat_ws(' ', row_json ->> 'comment', row_json ->> 'message', row_json ->> 'caption')) then
    raise exception 'Please leave out web links. Describe it in words instead.' using errcode = 'P0001';
  end if;
  perform private.check_contribution(
    TG_TABLE_NAME,
    case when TG_TABLE_NAME = 'reviews' then row_json ->> 'venue_slug' end
  );
  return new;
end;
$$;

create trigger guard_contribution before insert on public.routes for each row execute function private.guard_contribution();
create trigger guard_contribution before insert on public.photos for each row execute function private.guard_contribution();
create trigger guard_contribution before insert on public.route_photos for each row execute function private.guard_contribution();
create trigger guard_contribution before insert on public.reviews for each row execute function private.guard_contribution();
create trigger guard_contribution before insert on public.reports for each row execute function private.guard_contribution();

-- Storage: at most so many new files per bucket per hour, whoever sends them.
create or replace function private.bucket_has_room(p_bucket text, p_per_hour integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) < p_per_hour from storage.objects where bucket_id = p_bucket and created_at > now() - interval '1 hour';
$$;
grant usage on schema private to anon, authenticated;
grant execute on function private.bucket_has_room(text, integer) to anon, authenticated;

drop policy if exists "upload gpx" on storage.objects;
create policy "upload gpx" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'gpx' and name ~ '^[a-z0-9-]+\.gpx(\.gz)?$' and private.bucket_has_room('gpx', 120));

drop policy if exists "upload photos" on storage.objects;
create policy "upload photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos' and name ~ '^[a-z0-9-]+/[a-z0-9-]+\.(jpg|jpeg|png|webp)$' and private.bucket_has_room('photos', 300));

drop policy if exists "upload route thumbs" on storage.objects;
create policy "upload route thumbs" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'route-thumbs' and name ~ '^[a-z0-9-]+\.jpg$' and private.bucket_has_room('route-thumbs', 200));
