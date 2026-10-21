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

create trigger sync_route_contributor after update of username on public.profiles
  for each row execute function private.sync_route_contributor();
