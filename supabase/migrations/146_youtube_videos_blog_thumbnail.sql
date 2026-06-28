-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 146 — Optional custom blog hero (featured image) per video.
--
-- By default MVP uses the YouTube video's thumbnail as the blog post's main
-- hero / featured image. The Library card now has an optional
-- "Upload My Own Blog Thumbnail" button so a creator can supply a different,
-- purpose-made image for the article page.
--
-- The uploaded image lives in the existing product-images storage bucket at
-- {user_id}/{videoId}-blogthumb.{ext}; this column just stores its public URL.
-- blog/generate prefers it over the YT thumbnail when setting WP featured_media.
-- Either way the image is the post's featured image ONLY — it is never inserted
-- into the article body, because the post already embeds the YouTube video.

alter table public.youtube_videos
  add column if not exists blog_thumbnail_url text;

comment on column public.youtube_videos.blog_thumbnail_url is
  'Optional creator-uploaded custom blog hero (featured image) URL. When set, blog/generate uses it as the WP featured_media instead of the YouTube thumbnail. Featured image only — never inserted into the article body.';
