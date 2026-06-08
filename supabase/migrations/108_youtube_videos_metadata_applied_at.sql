-- © 2026 Gominplanet / MVP Affiliate
--
-- Track when a user pushes Co-Pilot-generated metadata BACK to YouTube via
-- our /api/youtube/apply or /api/youtube/update-metadata routes. Powers the
-- "🚀 Pushed via Co-Pilot" tab on the YouTube Co-Pilot page so the user can
-- see at a glance which videos they've already shipped through our system
-- vs. which are still TODO.
--
-- This is AUTHORITATIVE — different from the existing "✅ Done" tab which
-- is heuristic (description contains an affiliate link). The new column is
-- a real timestamp written only when WE successfully push to YouTube.
--
-- Mirrors the pattern of tiktok_posted_at (migration 082) + instagram_posted_at
-- (migration 083).

alter table public.youtube_videos
  add column if not exists youtube_metadata_applied_at timestamptz;

-- Index for fast "shipped videos for this user" queries (the drafts API
-- needs to bulk-join applied state for ~25-500 videos per page load).
create index if not exists youtube_videos_user_applied_idx
  on public.youtube_videos (user_id, youtube_metadata_applied_at desc)
  where youtube_metadata_applied_at is not null;
