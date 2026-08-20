-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 263 — extra Keepa card signals (parity with what Oink surfaces).
--
-- These all ride the /product responses we ALREADY fetch (no extra Keepa
-- tokens): variation parent ASIN, current sales rank + the named category it's
-- in, and the product's first-listed date (product age). We store them on the
-- three product-card tables so every card can show them.
--
--   deal_radar_cache      — already has numeric category_id + sales_rank (the
--                           latter is actually the category ref in the deal
--                           path); add a readable category name, the named-rank
--                           category, parent ASIN, and listed-since.
--   storefront_product_cards — has category text; add the rest.
--   cc_campaign_catalog   — add all (had none of these).

-- ── deal_radar_cache ────────────────────────────────────────────────────────
alter table if exists public.deal_radar_cache
  add column if not exists parent_asin          text,
  add column if not exists category             text,   -- readable name
  add column if not exists sales_rank_category  text,
  add column if not exists listed_since         date;

-- ── storefront_product_cards ────────────────────────────────────────────────
alter table if exists public.storefront_product_cards
  add column if not exists parent_asin          text,
  add column if not exists sales_rank           integer,
  add column if not exists sales_rank_category  text,
  add column if not exists listed_since         date;

-- ── cc_campaign_catalog ─────────────────────────────────────────────────────
alter table if exists public.cc_campaign_catalog
  add column if not exists category             text,
  add column if not exists parent_asin          text,
  add column if not exists sales_rank           integer,
  add column if not exists sales_rank_category  text,
  add column if not exists listed_since         date;
