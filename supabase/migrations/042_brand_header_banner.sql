-- Migration 042: brand_profiles.header_banner_url
--
-- A wide top-of-page banner image (recommended ~1920x240) that
-- replaces the centered small logo in the blog's top strip when
-- present. Separate from `logo_url` (favicon + footer) and
-- `headshot_url` (round About-Us photo) so each can serve its
-- own purpose without compromise.
--
-- The theme falls back to logo_url when this is empty, so existing
-- users aren't disturbed.
--
-- Idempotent.

alter table public.brand_profiles
  add column if not exists header_banner_url text;
