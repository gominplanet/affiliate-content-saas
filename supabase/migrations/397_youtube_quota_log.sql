-- Migration 397: every YouTube API call, what it cost and for whom.
--
-- MVP has one YouTube Data API quota a day for every account together. On the
-- day it ran out nobody could say who or what had spent it, because no call was
-- recorded anywhere. Each call MVP makes is now one row here: the Pacific day
-- (the quota resets at midnight Pacific), the account whose token made it, the
-- API method and its cost in quota units. A quota refusal is a row too, which
-- is how MVP knows to stop calling until the reset.
--
-- Written by the server only (service role). Read by Admin > Costs.
-- Safe to run twice.

create table if not exists public.youtube_quota_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  day      date not null,
  user_id  uuid,
  method   text not null,
  units    integer not null default 0,
  ok       boolean not null default true
);

create index if not exists youtube_quota_log_day_idx on public.youtube_quota_log (day, method);
create index if not exists youtube_quota_log_day_user_idx on public.youtube_quota_log (day, user_id);

alter table public.youtube_quota_log enable row level security;

-- Units spent on a day, summed in the database (PostgREST cannot sum).
create or replace function public.youtube_quota_spent(p_day date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(units), 0)::bigint from public.youtube_quota_log where day = p_day
$$;

revoke all on function public.youtube_quota_spent(date) from public, anon, authenticated;
grant execute on function public.youtube_quota_spent(date) to service_role;

-- The day by account and method, for Admin > Costs.
create or replace function public.youtube_quota_by(p_day date)
returns table (user_id uuid, method text, calls bigint, units bigint, failed bigint)
language sql
stable
security definer
set search_path = public
as $$
  select l.user_id, l.method, count(*)::bigint, coalesce(sum(l.units), 0)::bigint, count(*) filter (where not l.ok)::bigint
  from public.youtube_quota_log l
  where l.day = p_day
  group by l.user_id, l.method
$$;

revoke all on function public.youtube_quota_by(date) from public, anon, authenticated;
grant execute on function public.youtube_quota_by(date) to service_role;

notify pgrst, 'reload schema';
