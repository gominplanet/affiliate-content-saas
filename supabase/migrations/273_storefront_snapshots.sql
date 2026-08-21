-- 273 — Daily snapshots of the storefront headline totals.
--
-- The storefront's period-over-period deltas need a prior data point. For
-- weekly/monthly that's the previous period_start, but for Year-to-date there's
-- only ever ONE period_start (this year), so every KPI shows "no prior period".
--
-- This captures a dated snapshot of the authoritative headline totals (summed
-- across sources) each time SCOUT syncs. Analytics then compares the latest
-- snapshot against an earlier one, so a creator who syncs their year every so
-- often sees "up $X since <date>" instead of a dead trend. One row per
-- (user, period_type, day) — a re-sync on the same day just updates it.
-- Idempotent.

create table if not exists public.storefront_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_type text not null check (period_type in ('weekly', 'monthly', 'ytd')),
  taken_on date not null,
  earnings_cents bigint,
  revenue_cents bigint,
  units integer,
  clicks integer,
  taken_at timestamptz not null default now(),
  unique (user_id, period_type, taken_on)
);

create index if not exists storefront_snapshots_user_idx
  on public.storefront_snapshots (user_id, period_type, taken_on);

alter table public.storefront_snapshots enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'storefront_snapshots'
      and policyname = 'own snapshots read'
  ) then
    create policy "own snapshots read" on public.storefront_snapshots
      for select using (auth.uid() = user_id);
  end if;
end $$;

notify pgrst, 'reload schema';
