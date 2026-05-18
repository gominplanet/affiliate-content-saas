-- Migration 024: blog_posts.video_id nullable (campaign posts have no video)
--
-- The YouTube pipeline always sets video_id, so the column was created
-- NOT NULL. Campaign posts (the Creator Connections engine) are built
-- from an ASIN + web research — there is no source video. Without this,
-- the campaign route's blog_posts insert silently fails, blog_post_id
-- never links back to the campaign, and the post-publish social pills
-- can't appear (the WP post still publishes, which is why it looked
-- "done" but had no fan-out).
--
-- Idempotent: if video_id is already nullable this is a harmless no-op.

alter table public.blog_posts
  alter column video_id drop not null;
