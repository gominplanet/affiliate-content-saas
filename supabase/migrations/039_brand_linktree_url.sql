-- Migration 039: brand_profiles.linktree_url
--
-- A single link-hub URL (Linktree, Beacons, etc.) on the per-user
-- profile. Edited on Brand Profile alongside Amazon storefront, and
-- pre-fills the Collaborations pitch email's portfolio link so the
-- creator doesn't retype it every pitch.
--
-- Idempotent.

alter table public.brand_profiles
  add column if not exists linktree_url text;
