-- 288 — shared cross-user Keepa product cache.
--
-- EPC enrichment (image / rank / monthly-sold / price history) was fetched
-- per-user: if two creators had the same product in their EPC library, MVP paid
-- Keepa for it twice. Popular products show up in MANY creators' libraries, so
-- that overlap is real, repeated spend. This table caches one Keepa result per
-- ASIN, shared by every user. Enrichment now reads the cache first and only hits
-- Keepa for ASINs nobody has fetched recently (or whose data has gone stale),
-- then writes the result back for the next creator. Per-user epc_products rows
-- are still populated from this cache, so nothing about the per-user library
-- changes — only who pays Keepa.
--
-- Operator-owned data (not user-specific): the service-role client reads/writes
-- it; RLS is on with no public policy so it's never exposed to a session.

create table if not exists public.keepa_product_cache (
  asin                text primary key,
  image_url           text,
  sales_rank          int,
  sales_rank_avg90    int,
  sales_rank_category text,
  monthly_sold        int,
  price_now_cents     int,
  price_avg_cents     int,
  price_lowest_cents  int,
  discount_pct        int,
  deal_quality        text,
  -- true when Keepa returned NOTHING for this ASIN — a tombstone so we don't
  -- re-fetch a no-data product on every creator who scans it (until it goes stale).
  empty               boolean not null default false,
  fetched_at          timestamptz not null default now()
);
create index if not exists keepa_product_cache_fetched_idx on public.keepa_product_cache (fetched_at);

alter table public.keepa_product_cache enable row level security;
-- No policies on purpose: only the service-role (admin) client touches this.

notify pgrst, 'reload schema';
