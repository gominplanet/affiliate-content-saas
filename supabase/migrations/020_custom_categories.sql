-- Migration 020: User-defined custom categories
--
-- The 20 master niches we hardcode are good defaults but never the full
-- picture — a creator covering "Smart Home Locks" or "Espresso Equipment"
-- wants those as actual categories on their site, not just generic
-- "Electronics & Tech" / "Home & Kitchen" buckets.
--
-- Users can add custom categories from the Content page dropdown (click
-- "+ Add new category…"). They join the master list in the per-video
-- picker and survive across sessions.

alter table public.brand_profiles
  add column if not exists custom_categories text[] default '{}'::text[];
