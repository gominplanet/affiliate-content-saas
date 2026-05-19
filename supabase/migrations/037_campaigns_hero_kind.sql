-- Migration 037: campaigns.hero_kind
--
-- Records which path produced the post's 16:9 featured image:
--   'ai'      → DALL-E hero from the generated hero prompt
--   'product' → Amazon product photo letterboxed onto a 16:9 canvas
--                (the silent fallback when OpenAI is unavailable/failed)
--   null      → pre-feature post, or no image at all
--
-- Surfaced as a per-post badge so a silent fallback is visible instead
-- of a mystery. Idempotent.

alter table public.campaigns
  add column if not exists hero_kind text;
