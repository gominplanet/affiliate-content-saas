-- Migration 017: Instagram image post path for horizontal videos
--
-- For long-form 16:9 YouTube videos, uploading the raw MP4 to Instagram
-- doesn't work well (IG feed prefers 1:1 or 4:5 — 16:9 letterboxes). The
-- better cross-post is a composed image: brand-colored 4:5 canvas with
-- the YouTube thumbnail + title + logo. We render it server-side via
-- @vercel/og and host the PNG in Supabase Storage.
--
-- The user clicks "Publish to Instagram" on a horizontal video card,
-- we auto-generate the image (no upload step), preview the caption,
-- and publish to feed (and optionally Story).

alter table public.youtube_videos
  add column if not exists instagram_image_url text;

-- Publish id for image posts (distinct from instagram_reel_id which
-- is video-only). Reusing instagram_story_id is fine — Story works
-- for both image and video.
alter table public.blog_posts
  add column if not exists instagram_image_post_id text;

-- Storage bucket for generated 4:5 thumbnail composites. Public so
-- Instagram's CDN can fetch the image_url during publish.
--
--   insert into storage.buckets (id, name, public)
--     values ('instagram-images', 'instagram-images', true)
--     on conflict (id) do nothing;
