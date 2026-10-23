-- Close the username-to-email disclosure and restrict privileged account RPCs.
-- Run after account setup, or use 20261024000000_repair_accounts.sql, which
-- includes this hardening. Safe to rerun. Email and Google sign-in continue
-- working; the frontend must use email rather than username for sign-in/reset.
begin;

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
