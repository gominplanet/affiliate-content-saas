-- 067_yt_backlink_toggle.sql
-- Competitive P1 (#21): when a blog post is published from a YouTube video and
-- the creator has YouTube connected, MVP appends a "Full written review"
-- backlink to that video's description (video→blog cross-linking for SEO).
-- This writes to the user's own channel, so it's user-controllable — default
-- ON, with a toggle in Setup → Integrations. Safe to paste in full.

alter table public.integrations
  add column if not exists yt_backlink_enabled boolean not null default true;
