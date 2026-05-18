-- Migration 031: banner-ad price on collaborations
--
-- When the creator offers a paid banner placement they now specify the
-- price; store it like production_fee_amount. Idempotent.

alter table public.collaborations
  add column if not exists banner_ads_amount text;
