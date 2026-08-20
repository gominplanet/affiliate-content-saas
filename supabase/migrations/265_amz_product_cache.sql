-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 265 — shared AMZ Research product-signal cache.
--
-- AMZ Research runs Keepa's Product Finder, which returns only ASINs. Signals
-- (price, rating, sales rank + trend, age, video) then come from a live Keepa
-- product call — costly, so we only enrich the top results of each search. Those
-- results used to be thrown away after one render. This table PERSISTS them: an
-- ASIN enriched once stays rich for free on every future search (its own, a
-- best-seller list, a repeat query) until it goes stale. The token spend
-- compounds into a growing shared asset instead of being re-paid each search.
--
-- Shared (no user scope): a product's signals are the same fact for everyone,
-- same as deal_radar_cache. Written by the service role; readable by any signed-
-- in user.

create table if not exists public.amz_product_cache (
  asin                 text primary key,
  image_url            text,
  price_now_cents      integer,
  price_was_cents      integer,
  discount_pct         integer,
  rating               numeric,
  review_count         integer,
  monthly_sold         integer,
  video_count          integer,
  has_video            boolean,
  category             text,
  parent_asin          text,
  sales_rank           integer,
  sales_rank_avg90     integer,
  sales_rank_category  text,
  listed_since         date,
  refreshed_at         timestamptz not null default now()
);

-- Skip re-enriching ASINs we refreshed recently (freshness window enforced in code).
create index if not exists amz_product_cache_refreshed_idx on public.amz_product_cache (refreshed_at);

alter table public.amz_product_cache enable row level security;

-- Any signed-in user may read the shared signal cache; only the service role writes.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'amz_product_cache' and policyname = 'amz_product_cache_read'
  ) then
    create policy amz_product_cache_read on public.amz_product_cache for select to authenticated using (true);
  end if;
end $$;
