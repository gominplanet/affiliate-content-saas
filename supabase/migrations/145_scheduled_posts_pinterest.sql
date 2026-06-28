-- 145_scheduled_posts_pinterest.sql
--
-- Allow Pinterest in the scheduler. The Schedule-post modal can now queue a
-- Pinterest pin alongside the text socials; the cron (process-scheduled) pins
-- the blog's image and links back to the post via publishPinForPost.
--
-- scheduled_posts.platform has a CHECK constraint (last set in migration 137)
-- listing the allowed platforms — 'pinterest' wasn't in it, so scheduled pins
-- would be rejected at insert. Widen it. Idempotent (drop-then-add).

alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_platform_check;

alter table public.scheduled_posts
  add constraint scheduled_posts_platform_check
  check (platform in (
    'facebook', 'threads', 'twitter', 'linkedin', 'bluesky', 'telegram',
    'tiktok', 'instagram', 'pinterest'
  ));
