-- 224 — Storefront Stats v2: real per-product earnings from Amazon Influencer
--
-- Amazon has no earnings API, so the SCOUT extension reads the creator's
-- authenticated earnings/reports pages and posts per-ASIN totals here (bearer
-- token = integrations.cc_ingest_token, same as the CC ingest). This table is
-- the history the Storefront Stats page reads for units / revenue / commission
-- and week-over-week / month-over-month trend.
--
-- Per-ASIN, per-period (weekly + monthly). Clicks stay best-effort here (the
-- real click number comes from Geniuslink); this table's job is SALES.

create table if not exists public.storefront_earnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asin text not null,
  -- 'weekly' | 'monthly' — the report granularity this row summarizes.
  period_type text not null check (period_type in ('weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  -- Units shipped/ordered in the period. ordered_items = items ordered (may
  -- differ from shipped); units = shipped. Either may be null depending on which
  -- Amazon report the row came from.
  units integer,
  ordered_items integer,
  -- Product sales value (what buyers paid) and the creator's earnings, in cents.
  revenue_cents bigint,
  commission_cents bigint,
  -- Optional clicks from the Amazon report; Geniuslink is the primary click
  -- source, so this is just a cross-check when Amazon provides it.
  clicks integer,
  source text not null default 'scout',
  synced_at timestamptz not null default now(),
  -- One row per product per period — re-syncs upsert in place.
  unique (user_id, asin, period_type, period_start)
);

create index if not exists storefront_earnings_user_period_idx
  on public.storefront_earnings (user_id, period_type, period_start desc);
create index if not exists storefront_earnings_user_asin_idx
  on public.storefront_earnings (user_id, asin);

alter table public.storefront_earnings enable row level security;

-- Owner can read their own rows (the dashboard). Writes are service-role only
-- (the ingest endpoint), so no insert/update/delete policies.
drop policy if exists storefront_earnings_select_own on public.storefront_earnings;
create policy storefront_earnings_select_own on public.storefront_earnings
  for select using (auth.uid() = user_id);

-- "Last synced" stamp so the page can show freshness.
alter table public.integrations
  add column if not exists storefront_synced_at timestamptz;
