-- Migration 029: private product-sample shipping details on brand_profiles
--
-- Where brands ship product samples to the creator. PRIVATE — never
-- shown on the blog, never synced to WordPress, never shared. Used
-- only to pre-fill collaboration emails.
--
-- Idempotent.

alter table public.brand_profiles
  add column if not exists sample_full_name text,
  add column if not exists sample_address   text,
  add column if not exists sample_phone     text;
