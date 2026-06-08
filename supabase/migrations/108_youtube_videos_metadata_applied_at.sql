-- © 2026 Gominplanet / MVP Affiliate
--
-- SUPERSEDED by migration 109. Originally intended to add a
-- `youtube_metadata_applied_at` column to public.youtube_videos for
-- tracking Co-Pilot pushes — but that table has 4 NOT NULL columns
-- (channel_id, channel_title, title, published_at) that aren't populated
-- until /api/youtube/sync runs. For Co-Pilot users who never sync, the
-- upsert from the apply route would silently fail the INSERT branch.
--
-- The replacement (migration 109) creates a dedicated tracking table
-- youtube_copilot_pushes with only the fields we need.
--
-- This migration is now a no-op. Safe to leave applied if it was already
-- run (the unused nullable column is harmless); also safe to skip on
-- fresh environments.

-- intentional no-op
select 1 where false;
