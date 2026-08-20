-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 264 — 90-day average sales rank (Tier A: rank trend).
--
-- Rides the same /product responses we already fetch (stats.avg90[3] — no extra
-- Keepa tokens). Storing the 90-day average rank next to the current rank lets a
-- card show momentum: current rank vs its 90-day average ("Rank rising #67 vs
-- #120 avg"). A LOWER Amazon rank number means more sales, so now < avg90 = the
-- product is climbing. Added to the same three product-card tables as 263.

alter table if exists public.deal_radar_cache
  add column if not exists sales_rank_avg90 integer;

alter table if exists public.storefront_product_cards
  add column if not exists sales_rank_avg90 integer;

alter table if exists public.cc_campaign_catalog
  add column if not exists sales_rank_avg90 integer;
