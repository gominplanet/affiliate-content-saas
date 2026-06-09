-- © 2026 Gominplanet / MVP Affiliate
--
-- Persist the YT Co-Pilot's Geniuslink shortcode on the youtube_videos
-- row so /analytics can attribute YouTube-description clicks to the
-- per-user MVP-YOUTUBE group.
--
-- Without this column we have no way to look up YT-side click totals —
-- the link gets created by /api/youtube/generate-metadata and embedded
-- in the YouTube description, but the code is never persisted, so the
-- analytics aggregator can't include it in the MVP-YOUTUBE bucket.
--
-- Sibling of blog_posts.geniuslink_code (which serves the same purpose
-- for the per-site blog groups).

alter table public.youtube_videos
  add column if not exists geniuslink_yt_code text;

comment on column public.youtube_videos.geniuslink_yt_code is
  'Shortcode of the Geniuslink MVP created for the YT Co-Pilot description (the part after geni.us/). Populated by /api/youtube/generate-metadata and queried by /api/analytics/clicks to attribute clicks to the MVP-YOUTUBE group.';
