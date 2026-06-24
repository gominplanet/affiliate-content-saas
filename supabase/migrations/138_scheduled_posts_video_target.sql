-- Migration 138: schedule Shorts that have no blog post
--
-- The vertical-post scheduler (migration 137) keyed everything on
-- blog_post_id. But the "Post Short to TikTok — direct push, no blog post
-- needed" flow posts straight from a youtube_videos row with no blog post.
-- Allow a scheduled row to target a video directly:
--   - blog_post_id becomes NULLABLE
--   - add video_id (FK youtube_videos)
--   - require at least one target
--
-- Existing rows (text socials, blog publishes, the 137 vertical rows) all
-- have blog_post_id set, so the new check passes for them unchanged.

alter table public.scheduled_posts
  alter column blog_post_id drop not null;

alter table public.scheduled_posts
  add column if not exists video_id uuid references public.youtube_videos(id) on delete cascade;

alter table public.scheduled_posts
  drop constraint if exists scheduled_posts_target_chk;

alter table public.scheduled_posts
  add constraint scheduled_posts_target_chk
  check (blog_post_id is not null or video_id is not null);
