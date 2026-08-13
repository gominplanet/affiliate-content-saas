-- 252 — Revive storefront_earnings (Amazon Influencer earnings, take 2).
--
-- Migration 230 dropped this in Aug 2026 when MVP stopped collecting Amazon
-- earnings (the old TOKEN-authed /api/storefront/ingest was the only writer, and
-- Amazon has no earnings API). We're bringing it back the MODERN way: a
-- SESSION-authed ingest endpoint (the signed-in MVP cookie, same posture as the
-- live SCOUT features), fed by SCOUT's Linked-Product report scraper. No token.
--
-- SCOUT can only read what Amazon renders (products with ~4+ shipments show),
-- so this holds a creator's PROVEN sellers — exactly the signal the Amazon
-- Brainstorm ("make more of what works") wants. Per-ASIN, per-period (weekly +
-- monthly). Owner-read RLS; writes go through the service-role endpoint after it
-- verifies the session.

create table if not exists public.storefront_earnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asin text not null,
  product_title text,
  -- 'weekly' | 'monthly' — the report granularity this row summarizes.
  period_type text not null check (period_type in ('weekly', 'monthly')),
  period_start date not null,
  period_end date not null,
  -- Items shipped in the period (Amazon "Items Shipped").
  units integer,
  -- "Items Shipped Revenue" and "Total Earnings", in cents.
  revenue_cents bigint,
  commission_cents bigint,
  -- Amazon's own click count for the row when the report provides it.
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

-- Owner can read their own rows (the dashboard + Brainstorm). Writes are
-- service-role only (the ingest endpoint verifies the session, then writes via
-- the admin client), so no insert/update/delete policies for end users.
drop policy if exists "own storefront_earnings" on public.storefront_earnings;
create policy "own storefront_earnings" on public.storefront_earnings
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
