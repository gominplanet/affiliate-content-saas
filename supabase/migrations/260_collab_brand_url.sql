-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 260 — brand website URL on collaborations.
--
-- The pitch composer captured the creator's OWN links (website_url, youtube_url)
-- but never the BRAND's own site, so the Brand Hub timeline had nothing
-- brand-side to link to for a pitch. This adds an optional brand_url the creator
-- can drop in when they know the brand's website / contact page.

alter table public.collaborations
  add column if not exists brand_url text;
