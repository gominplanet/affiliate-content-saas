-- Migration 016: Track YouTube video orientation (Short vs long-form)
--
-- Used by the Content page to split the Videos tab into "Horizontal Videos"
-- (long-form 16:9 — generate blog posts from these) and "Vertical Videos"
-- (Shorts 9:16 — use as source for Instagram Reels/Stories).
--
-- The flag is populated from contentDetails.duration during YouTube sync:
--   - duration ≤ 180s OR title/description contains "#Shorts" → is_vertical = true
--   - otherwise → false
--
-- For backwards compatibility, existing rows stay null until the next sync,
-- at which point they'll get classified. The Content page tabs handle null
-- as "horizontal" so the default UI looks unchanged for un-synced rows.

alter table public.youtube_videos
  add column if not exists is_vertical     boolean,
  add column if not exists duration_seconds integer;
