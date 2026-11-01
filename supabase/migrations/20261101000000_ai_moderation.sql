-- Automated moderation: every contribution is screened inside the database
-- transaction, so no client can skip it.
--
-- A BEFORE trigger calls the site's /api/moderate endpoint (a Cloudflare
-- Pages function that holds the OpenAI key and asks omni-moderation-latest)
-- and refuses the write when the answer comes back flagged. The refusal is a
-- P0001 sentence, so the caller — the app or a hand-written API request —
-- is told in the response. Flagged content is never stored: there is no
-- "published then hidden" window. The browser also pre-checks through the
-- same endpoint (src/lib/moderate.ts) for instant feedback, but the trigger
-- is the enforcement, not the pre-check.
--
-- Screened fields: reviews.comment, route_reviews.comment (insert and edit),
-- routes.name (insert and rename via edit_community_route), photos and
-- route_photos images plus route_photos.caption, and profiles.username.
-- Reports are not screened — only moderators see them.
--
-- The one soft case is profiles INSERT: it fires inside sign-up, where the
-- name may be an auto-suggestion the person never chose, so a flagged name
-- is swapped for a generated climber-XXXXXXXX handle instead of refusing the
-- account. Everywhere else a flag refuses the write; a rename that picks a
-- flagged name refuses too.
--
-- Failure mode is fail-closed: if the endpoint cannot answer, the write is
-- refused with a try-again sentence rather than let through unchecked. Flip
-- it while investigating an outage:
--   update private.settings set value = 'open' where key = 'moderation_fail';
-- and back to 'closed' after. Every refusal, reset and outage is noted with
-- raise log (the refusal rolls its transaction back, so a table would never
-- keep the record): Dashboard → Logs → Postgres logs, filter
-- "moderation_gate".
--
-- A photo upload that is refused at the row leaves its file behind in the
-- bucket; run select public.purge_orphan_photos() in the SQL editor to sweep
-- files older than half an hour that no row points at.
--
-- Needs the http extension (Database → Extensions → http, or the create
-- below) and /api/moderate deployed with OPENAI_API_KEY set. Apply in the
-- Supabase dashboard (SQL editor → paste this file → Run), or with
-- `supabase db push`. Safe to rerun.
begin;

create extension if not exists http with schema extensions;

insert into private.settings (key, value) values
  ('moderation_url', 'https://hillgpx.com/api/moderate'),
  ('moderation_fail', 'closed')
on conflict (key) do nothing;

create or replace function private.moderation_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_json jsonb := to_jsonb(new);
  inputs jsonb := '[]'::jsonb;
  messages text[] := '{}';
  photos_base constant text := 'https://dzpgnebkyubeptitzjlj.supabase.co/storage/v1/object/public/photos/';
  url text := (select value from private.settings where key = 'moderation_url');
  fail_mode text := coalesce((select value from private.settings where key = 'moderation_fail'), 'closed');
  resp_status integer;
  resp_body text;
  results jsonb;
  i integer;
  refused text;
  flagged boolean := false;
begin
  -- Which fields this table sends, in a fixed order; messages[i] is the
  -- sentence for inputs[i] so a refused row can say which field failed.
  if TG_TABLE_NAME in ('reviews', 'route_reviews') then
    inputs := inputs || jsonb_build_object('type', 'text', 'text', row_json ->> 'comment');
    messages := messages || 'That review can''t be published — it was flagged by our automated checks.';
  elsif TG_TABLE_NAME = 'routes' then
    inputs := inputs || jsonb_build_object('type', 'text', 'text', row_json ->> 'name');
    messages := messages || 'That route name can''t be published — it was flagged by our automated checks.';
  elsif TG_TABLE_NAME = 'profiles' then
    inputs := inputs || jsonb_build_object('type', 'text', 'text', row_json ->> 'username');
    messages := messages || 'That username isn''t allowed — pick another.';
  elsif TG_TABLE_NAME in ('photos', 'route_photos') then
    -- The file is uploaded before the row insert, so its public URL is
    -- already live for OpenAI to fetch.
    inputs := inputs || jsonb_build_object('type', 'image', 'url', photos_base || (row_json ->> 'storage_path'));
    messages := messages || 'That photo can''t be published — it was flagged by our automated checks.';
    if TG_TABLE_NAME = 'route_photos' and nullif(row_json ->> 'caption', '') is not null then
      inputs := inputs || jsonb_build_object('type', 'text', 'text', row_json ->> 'caption');
      messages := messages || 'That caption can''t be published — it was flagged by our automated checks.';
    end if;
  else
    return new;
  end if;

  if url is null or url = '' then
    resp_status := 0;
  else
    begin
      -- Stay under PostgREST's statement timeout: a slow check counts as
      -- unreachable rather than holding the write open.
      perform set_config('http.timeout_msec', '5000', true);
    exception when others then
      null;
    end;
    begin
      select h.status, h.content into resp_status, resp_body
      from extensions.http_post(url, jsonb_build_object('inputs', inputs)::text, 'application/json') h;
    exception when others then
      resp_status := 0;
      resp_body := null;
    end;
  end if;

  if resp_status = 200 then
    begin
      results := resp_body::jsonb -> 'results';
    exception when others then
      -- An unparseable 200 is no verdict: count it as unreachable.
      resp_status := -1;
    end;
    for i in 1 .. coalesce(array_length(messages, 1), 0) loop
      if coalesce((results -> (i - 1) ->> 'flagged')::boolean, false) then
        refused := coalesce(refused, messages[i]);
        flagged := true;
      end if;
    end loop;
  end if;

  if flagged then
    -- A flagged username on profile INSERT means the sign-up flow itself is
    -- being screened (the suggested name may not even be the person's
    -- choice): swap it for a generated handle rather than refuse the whole
    -- account. A chosen rename still refuses outright below.
    if TG_TABLE_NAME = 'profiles' and TG_OP = 'INSERT' then
      loop
        new.username := 'climber-' || substr(replace(extensions.gen_random_uuid()::text, '-', ''), 1, 8);
        exit when not exists (select 1 from public.profiles p where lower(p.username) = lower(new.username));
      end loop;
      raise log 'moderation_gate reset a flagged username on sign-up: %', results;
      return new;
    end if;
    raise log 'moderation_gate refused % on %: %', TG_OP, TG_TABLE_NAME, results;
    raise exception '%', refused using errcode = 'P0001';
  end if;

  if resp_status is distinct from 200 then
    raise log 'moderation_gate check unreachable for % (http %)', TG_TABLE_NAME, coalesce(resp_status::text, 'net');
    if fail_mode = 'open' then
      return new;
    end if;
    raise exception 'Our automated checks aren''t reachable right now — please try again in a little while.' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Insert paths. The gate runs after the cheap spam checks (trigger names run
-- alphabetically: guard_contribution < moderation_gate < stamp_*_owner).
drop trigger if exists moderation_gate on public.reviews;
create trigger moderation_gate before insert on public.reviews
  for each row execute function private.moderation_gate();
drop trigger if exists moderation_gate on public.route_reviews;
create trigger moderation_gate before insert on public.route_reviews
  for each row execute function private.moderation_gate();
drop trigger if exists moderation_gate_edit on public.route_reviews;
create trigger moderation_gate_edit before update of comment on public.route_reviews
  for each row execute function private.moderation_gate();
drop trigger if exists moderation_gate on public.routes;
create trigger moderation_gate before insert on public.routes
  for each row execute function private.moderation_gate();
drop trigger if exists moderation_gate_edit on public.routes;
create trigger moderation_gate_edit before update of name on public.routes
  for each row execute function private.moderation_gate();
drop trigger if exists moderation_gate on public.photos;
create trigger moderation_gate before insert on public.photos
  for each row execute function private.moderation_gate();
drop trigger if exists moderation_gate on public.route_photos;
create trigger moderation_gate before insert on public.route_photos
  for each row execute function private.moderation_gate();
drop trigger if exists moderation_gate on public.profiles;
create trigger moderation_gate before insert on public.profiles
  for each row execute function private.moderation_gate();
drop trigger if exists moderation_gate_edit on public.profiles;
create trigger moderation_gate_edit before update of username on public.profiles
  for each row execute function private.moderation_gate();

-- Files in the photos bucket that no row uses (a refused insert leaves its
-- upload behind). Dashboard-only: no grant to the API roles, so run it in
-- the SQL editor. Returns how many objects were deleted.
create or replace function public.purge_orphan_photos()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from storage.objects o
  where o.bucket_id = 'photos'
    and o.created_at < now() - interval '30 minutes'
    and not exists (select 1 from public.photos p where p.storage_path = o.name)
    and not exists (select 1 from public.route_photos rp where rp.storage_path = o.name);
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function private.moderation_gate() from public, anon, authenticated;
revoke all on function public.purge_orphan_photos() from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
