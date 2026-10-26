-- Saved routes and places belong to the signed-in account and follow it to
-- every device. Until now they lived only in the browser's localStorage
-- (hillgpx:favorites, hillgpx:routeBookmarks); the app merges those into the
-- account the first time someone signs in (the primary key makes that an
-- idempotent upsert) and then clears them.
--
-- One row per saved thing. `slug` is a curated or community route slug for
-- kind 'route', and a venue / world-summit slug for kind 'place'. Slugs are not
-- foreign keys: venues and curated routes are static files, not tables.
-- Rows are private to their owner and go with the account.
-- Safe to rerun. Apply in the SQL Editor (or `supabase db push`).
begin;

create schema if not exists private;

create table if not exists public.saved_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('route', 'place')),
  slug text not null check (char_length(slug) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, slug)
);

alter table public.saved_items enable row level security;

drop policy if exists "read own saved items" on public.saved_items;
drop policy if exists "save as myself" on public.saved_items;
drop policy if exists "unsave my own" on public.saved_items;

create policy "read own saved items" on public.saved_items
  for select to authenticated using (user_id = auth.uid());
create policy "save as myself" on public.saved_items
  for insert to authenticated with check (user_id = auth.uid());
create policy "unsave my own" on public.saved_items
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.saved_items from anon, public;
grant select, insert, delete on public.saved_items to authenticated;

-- Hard ceiling so one account cannot fill the table.
create or replace function private.cap_saved_items()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.saved_items where user_id = new.user_id) >= 2000 then
    raise exception 'You have saved the most items allowed.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.cap_saved_items() from public, anon, authenticated;

drop trigger if exists cap_saved_items on public.saved_items;
create trigger cap_saved_items before insert on public.saved_items
  for each row execute function private.cap_saved_items();

commit;
