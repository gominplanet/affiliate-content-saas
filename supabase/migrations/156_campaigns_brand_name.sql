-- Migration 156: real brand name on campaigns
--
-- SCOUT captures the campaign card's `campaign-card-brand-name` (the actual
-- brand) separately from the product-ish campaign_name. We now store it so the
-- "Message Brand" draft greets the BRAND ("Hi <Brand> team,"), not the product
-- ("Hey Air Purifiers for Home team,"). Nullable; legacy rows stay null and the
-- outreach API falls back to a neutral greeting when it's missing.

alter table public.campaigns
  add column if not exists brand_name text;
