-- Re-assert owner route deletion: canonical delete_community_route body and
-- its grants. Projects where earlier account SQL was applied by hand or in
-- part can end up with a stale function body or a missing EXECUTE grant —
-- both surface in the app as an undeletable upload. This file is a no-op on
-- projects that already match; it only rewrites the function and its grants.
-- Safe to rerun. Apply in the SQL Editor (or `supabase db push`).
begin;

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

-- A GRANT does not remove PostgreSQL's default EXECUTE grant to PUBLIC.
-- Revoke inherited/default access before granting precisely the intended roles.
revoke all on function public.delete_community_route(text) from public, anon, authenticated;
grant execute on function public.delete_community_route(text) to authenticated;

notify pgrst, 'reload schema';
commit;
