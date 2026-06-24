-- Migration 137: schedule TikTok + Instagram vertical posts
--
-- Extends the existing scheduled_posts pipeline (migration 021 + the
-- process-scheduled cron) to cover vertical video posts. Two changes:
--
--   1. Allow 'tiktok' and 'instagram' as platforms (previously only the
--      six text socials).
--   2. Add an `options` JSONB column for platform-specific settings that
--      don't fit the text-social shape — TikTok privacy + interaction +
--      commercial flags, and the Instagram Reel/Story mode. NULL for the
--      text platforms (they ignore it).
--
-- The cron resolves the 9:16 render + product from blog_post_id (already
-- NOT NULL on the table), so no new id columns are needed.

-- 1. Widen the platform check constraint.
alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_platform_check;

alter table public.scheduled_posts
  add constraint scheduled_posts_platform_check
  check (platform in (
    'facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram',
    'tiktok', 'instagram'
  ));

-- 2. Per-platform options (TikTok privacy/flags, IG mode). NULL by default.
alter table public.scheduled_posts
  add column if not exists options jsonb;
