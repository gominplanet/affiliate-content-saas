-- 269 — Storefront period totals (authoritative headline numbers).
--
-- The per-product report caps at ~100 rows and its "Next" pager can't be driven
-- from the extension, so summing the product rows undercounts a creator's real
-- income (top-100 commissions came to ~$9.6k against a true $37k). But Amazon
-- prints the REAL totals in the report's summary — Total Earnings, Total
-- Revenue, Shipped Items, Clicks — per tab (Commissions vs Creator Connections).
--
-- SCOUT reads those summary numbers and lands them here, one row per
-- (period, source). The storefront uses these for the headline KPIs and keeps
-- the top-100 product rows (storefront_earnings) for the "what's selling"
-- ranking. Idempotent.

create table if not exists public.storefront_period_totals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_type text not null check (period_type in ('weekly', 'monthly', 'ytd')),
  period_start date not null,
  period_end date,
  -- 'scout' = regular Commissions summary; 'creator_connections' = the CC tab.
  source text not null default 'scout',
  earnings_cents bigint,
  revenue_cents bigint,
  units integer,
  clicks integer,
  synced_at timestamptz not null default now(),
  unique (user_id, period_type, period_start, source)
);

alter table public.storefront_period_totals enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'storefront_period_totals'
      and policyname = 'own totals read'
  ) then
    create policy "own totals read" on public.storefront_period_totals
      for select using (auth.uid() = user_id);
  end if;
end $$;

notify pgrst, 'reload schema';
