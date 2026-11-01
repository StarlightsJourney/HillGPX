-- Questions, feedback and removal requests sent through the site's contact
-- form land in the same reports queue as everything else, so the moderators
-- keep one place to look. 'site' is the target for anything not tied to a
-- place, route or piece of content.

alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('venue', 'route', 'photo', 'route_photo', 'review', 'route_review', 'site'));
alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports add constraint reports_kind_check
  check (kind in ('wrong_details', 'hazard', 'closed', 'photo', 'abuse', 'other', 'question', 'feedback', 'removal', 'add_place'));

-- Where a private reply should go, if the writer wants one. The table stays
-- insert-only through the API, so only the dashboard ever reads it.
alter table public.reports add column if not exists reply_to text check (char_length(reply_to) <= 160);

-- Public text still may not carry links, but a contact message often needs
-- to point at the exact page or route it is about (a removal request above
-- all), so site reports are exempt from the no-links rule. The per-connection
-- and daily rate limits still apply.
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
  if private.has_link(concat_ws(' ', row_json ->> 'comment', row_json ->> 'message', row_json ->> 'caption'))
     and not (TG_TABLE_NAME = 'reports' and row_json ->> 'target_type' = 'site') then
    raise exception 'Please leave out web links. Describe it in words instead.' using errcode = 'P0001';
  end if;
  perform private.check_contribution(
    TG_TABLE_NAME,
    case when TG_TABLE_NAME = 'reviews' then row_json ->> 'venue_slug' end
  );
  return new;
end;
$$;
