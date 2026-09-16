-- 336_blog_posts_hero_source.sql
--
-- Where to get the featured image from, when re-attaching one later.
--
-- /api/cron/heal-thumbnails re-uploads a missing featured image every six
-- hours, and it can only do that for a post it can find a SOURCE image for. It
-- looks in two places, both of which belong to the video path:
--
--   youtube_videos.youtube_video_id   -> img.youtube.com/vi/<id>/maxres...
--   youtube_videos.blog_thumbnail_url -> the creator's uploaded hero
--
-- A post written from a LINK has neither. video_id is null, so the heal's
-- `if (!wpId || (!ytId && !customThumb)) continue` skips it entirely. One
-- creator has 123 posts of exactly that shape. Flagging them without this
-- column would give them a number on the SEO page that can never go down.
--
-- So the product photo the post was built from is stored on the row, and the
-- heal uses it as the third source. Nullable: every existing row keeps working,
-- and a post with no product photo simply has nothing to re-attach, which the
-- heal already handles by skipping.
--
-- Safe to run twice.

alter table public.blog_posts
  add column if not exists hero_source_url text;

comment on column public.blog_posts.hero_source_url is
  'Product/hero image the post was built from. Used by heal-thumbnails to re-attach a featured image on posts with no source video. See lib/reattach-thumbnails.ts';
