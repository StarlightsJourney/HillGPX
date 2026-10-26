-- Profile constants: username and email stay fixed to the account.
-- The UI no longer offers profile editing, but a determined visitor could
-- still PATCH their own row through the REST API — the row-level policy only
-- decides WHICH row, not which column. Table-level UPDATE is therefore
-- replaced by a column grant on avatar_path: the photo remains changeable,
-- username, id and created_at cannot be written by any client role.
-- Email changes are Supabase Auth calls (auth.updateUser), not table writes,
-- and require a confirmation email; the app no longer offers them either.
-- The "update own profile" RLS policy stays as the row gate. Safe to rerun.
begin;

revoke update on table public.profiles from public, anon, authenticated;
grant update (avatar_path) on table public.profiles to authenticated;

notify pgrst, 'reload schema';
commit;
