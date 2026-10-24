-- Editable usernames: owners may rename their public handle from the account
-- page. 20261024030000_profile_constants.sql narrowed the column grant to
-- avatar_path only, which also blocked renames; this restores username to
-- the writable set. The safety rails are unchanged:
--   * the "update own profile" RLS policy still decides WHICH row is open,
--   * the CHECK constraint still enforces the handle format,
--   * the unique index on lower(username) still enforces case-insensitive
--     uniqueness,
--   * the sync_route_contributor trigger rewrites contributor on the owner's
--     published routes that still carried the old name.
-- Apply in the Supabase dashboard (SQL editor → paste this file → Run), or
-- with `supabase db push`. Safe to rerun.
begin;

grant update (username, avatar_path) on table public.profiles to authenticated;

notify pgrst, 'reload schema';
commit;
