-- Migration 034: campaigns.cc_campaign_id
--
-- Amazon Creator Connections identifies a campaign by its Campaign Id
-- (distinct from the product ASIN). The .zip export carries it, so we
-- retain it on import — the user can then bulk-copy the IDs back into
-- Amazon's "Submit accepted campaigns" modal to accept them in one go.
--
-- Idempotent.

alter table public.campaigns
  add column if not exists cc_campaign_id text;
