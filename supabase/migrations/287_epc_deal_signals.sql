-- 287 — EPC library: price / deal / history signals from Keepa.
--
-- The EPC scan reads Amazon's Sponsored-Products card (title, price, EPC, budget,
-- rating). Migration 279 added the demand signals (monthly sold, sales rank).
-- This adds the PRICE-HISTORY signals a creator uses to spot a real deal: current
-- vs 90-day-average price, the all-time low, a computed discount %, and a deal
-- quality read. These already ride on the SAME Keepa stats=180 response the
-- enrichment already fetches, so populating them costs no extra Keepa tokens.

alter table public.epc_products
  add column if not exists sales_rank_avg90   int,     -- 90-day avg sales rank (trend)
  add column if not exists price_now_cents    int,     -- current price, cents (Keepa)
  add column if not exists price_avg_cents    int,     -- 90-day average price, cents
  add column if not exists price_lowest_cents int,     -- all-time-low price, cents
  add column if not exists discount_pct       int,     -- % below the 90-day average (0–99)
  add column if not exists deal_quality       text,    -- excellent | genuine | fair | weak
  -- A SEPARATE enrichment stamp for the deal signals. New column → null on every
  -- existing row, so the enrichment paths (which now gate on this) do one bounded
  -- backfill pass and then terminate (a row leaves the backlog once stamped, even
  -- if Keepa had no price for it). Keeps the token spend one-time per product,
  -- same pattern as enriched_at, without disturbing the image/rank enrichment.
  add column if not exists deal_enriched_at   timestamptz;

-- Backlog index for the paced global cron: it scans deal_enriched_at IS NULL
-- ordered by scanned_at with NO user_id predicate, so the (user_id, …) indexes
-- from 278 can't serve it. A partial index over just the backlog stays tiny and
-- serves both the filter and the ordering.
create index if not exists epc_products_deal_backlog_idx
  on public.epc_products (scanned_at) where deal_enriched_at is null;

-- Indexes for the new library sorts (per-user, so keep them user-led).
create index if not exists epc_products_user_sold_idx
  on public.epc_products (user_id, monthly_sold desc nulls last);
create index if not exists epc_products_user_rank_idx
  on public.epc_products (user_id, sales_rank asc nulls last);
create index if not exists epc_products_user_discount_idx
  on public.epc_products (user_id, discount_pct desc nulls last);

notify pgrst, 'reload schema';
