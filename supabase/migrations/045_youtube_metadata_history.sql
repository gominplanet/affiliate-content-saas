-- 045 — Persist YouTube Co-Pilot generated metadata on youtube_videos
--
-- We store the latest generated title / description / pinned comment /
-- tags per video so the metadata route can pull the user's 2 most-
-- recently-generated metadata blocks as in-context voice anchors —
-- same feedback loop the blog generator already runs against
-- blog_posts. The more videos a user processes, the more the
-- Co-Pilot sounds like them.

alter table public.youtube_videos
  add column if not exists generated_title text,
  add column if not exists generated_description text,
  add column if not exists generated_pinned_comment text,
  add column if not exists generated_tags jsonb,
  add column if not exists metadata_generated_at timestamptz;

-- Helps the "pull last 2 generated rows per user" query stay fast as
-- channels grow into the thousands of videos.
create index if not exists yt_videos_user_metagen_idx
  on public.youtube_videos (user_id, metadata_generated_at desc)
  where metadata_generated_at is not null;
