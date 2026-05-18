-- Migration 033: Amazon storefront URL on brand_profiles
--
-- Lives under Social Links in Brand Profile; prefills the
-- Collaborations form. Idempotent.

alter table public.brand_profiles
  add column if not exists amazon_storefront_url text;
