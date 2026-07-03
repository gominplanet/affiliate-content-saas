-- Migration 152: product-quality signals for SCOUT's deep import check
--
-- At import, SCOUT opens each product's Amazon page and reads two signals that
-- decide whether the product is worth bringing into MVP:
--   • monthly_sales      — Amazon's "X bought in past month" figure. Import rule:
--                          drop products below 100 (and drop when it's not shown).
--   • has_carousel_video — whether the top image carousel has a video. HARD rule:
--                          only products WITH a carousel video get imported.
-- Stored so the /epc list can show them and the gate is auditable after the fact.

alter table public.campaigns
  add column if not exists monthly_sales integer;

alter table public.campaigns
  add column if not exists has_carousel_video boolean;
