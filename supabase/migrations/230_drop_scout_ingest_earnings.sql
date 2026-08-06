-- 230 — Remove the SCOUT token-ingest + Amazon earnings feature.
--
-- Decision (2026-08): MVP no longer collects Amazon Influencer earnings/sales.
-- The ONLY writer of storefront_earnings was the SCOUT extension via the
-- token-authed /api/storefront/ingest endpoint (now deleted), and the
-- cc_ingest_token only ever authed that plus a legacy campaign push (also
-- deleted). Every LIVE SCOUT feature (Smart Scan, Accept, Message Brand,
-- YouTube frames, Product Finder, Shorts download) runs over the signed-in
-- session bridge and never touched this token, so nothing else depends on it.
-- Geniuslink click analytics (the rest of Storefront Stats) is unaffected.
--
-- Destructive + idempotent: drops the earnings table and the two integrations
-- columns. Amazon has no earnings API, so there is no server path to preserve.

drop table if exists public.storefront_earnings;

drop index if exists public.integrations_cc_ingest_token_idx;

alter table public.integrations
  drop column if exists cc_ingest_token,
  drop column if exists storefront_synced_at;
