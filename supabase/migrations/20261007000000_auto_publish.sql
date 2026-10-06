-- Publish first, let the community flag problems.
--
-- Photos and route photos used to wait for a maintainer. They now go live
-- straight away, like routes and reviews, held to the house rules on the
-- site (the Contributions page) and the automatic checks in the spam-limits
-- migration (rate limits, no links, file types and sizes). Visitors can
-- report a photo, a route photo or a review; once three different
-- connections have reported the same one, it is hidden at once (status back
-- to 'pending') and waits in the dashboard for a maintainer to restore it
-- ('approved') or remove it ('rejected').
--
-- Needs 20261006000000_spam_limits.sql first. Apply in the Supabase SQL
-- editor or with `supabase db push`.

alter table public.photos alter column status set default 'approved';
alter table public.route_photos alter column status set default 'approved';

drop policy if exists "contribute photos" on public.photos;
create policy "contribute photos" on public.photos for insert to anon, authenticated with check (status = 'approved');
drop policy if exists "contribute route photos" on public.route_photos;
create policy "contribute route photos" on public.route_photos for insert to anon, authenticated with check (status = 'approved');

-- Reports can now point at one photo, route photo or review (by its id), and
-- say it is spam or abusive.
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('venue', 'route', 'photo', 'route_photo', 'review'));
alter table public.reports drop constraint if exists reports_kind_check;
alter table public.reports add constraint reports_kind_check
  check (kind in ('wrong_details', 'hazard', 'closed', 'photo', 'abuse', 'other'));
-- Who reported, as the same salted one-way hash the spam limits use, so one
-- person reporting three times counts once. Never readable through the API.
alter table public.reports add column if not exists reporter_hash text;

create or replace function private.caller_hash()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.caller_ip() is null then null
    else encode(extensions.digest((select value from private.settings where key = 'ip_salt') || private.caller_ip(), 'sha256'), 'hex') end;
$$;

create or replace function private.stamp_reporter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.reporter_hash := private.caller_hash();
  return new;
end;
$$;
create trigger stamp_reporter before insert on public.reports for each row execute function private.stamp_reporter();

-- How many different reports hide something straight away.
insert into private.limits (kind, per_hour, per_day, total_per_day) values ('hide_after_reports', 3, 3, 3)
on conflict (kind) do nothing;

create or replace function private.hide_reported()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
  reporters integer;
  threshold integer := coalesce((select per_day from private.limits where kind = 'hide_after_reports'), 3);
begin
  if new.target_type not in ('photo', 'route_photo', 'review') then
    return null;
  end if;
  begin
    target := new.target_slug::uuid;
  exception when invalid_text_representation then
    return null;
  end;
  select count(distinct coalesce(reporter_hash, id::text)) into reporters
  from public.reports
  where target_type = new.target_type and target_slug = new.target_slug and status = 'pending'
    and created_at > now() - interval '30 days';
  if reporters >= threshold then
    if new.target_type = 'photo' then
      update public.photos set status = 'pending' where id = target and status = 'approved';
    elsif new.target_type = 'route_photo' then
      update public.route_photos set status = 'pending' where id = target and status = 'approved';
    else
      update public.reviews set status = 'pending' where id = target and status = 'approved';
    end if;
  end if;
  return null;
end;
$$;
create trigger hide_reported after insert on public.reports for each row execute function private.hide_reported();
