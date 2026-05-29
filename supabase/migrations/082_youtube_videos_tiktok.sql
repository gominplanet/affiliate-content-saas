-- 082 — Direct-push TikTok tracking on youtube_videos
--
-- Vertical Videos tab posts straight to TikTok (and Instagram) without
-- first generating a blog_post. For that, we need the same publish-state
-- columns we added on blog_posts (migration 081) directly on
-- youtube_videos so each Short carries its own TikTok history.
--
-- Mirrors blog_posts.tiktok_* shape exactly so the publish route can
-- treat both targets uniformly — just switch which table to read/write.

alter table public.youtube_videos
  add column if not exists tiktok_publish_id     text,
  add column if not exists tiktok_publish_status text,
  add column if not exists tiktok_share_url      text,
  add column if not exists tiktok_error_message  text,
  add column if not exists tiktok_posted_at      timestamptz;

-- Fast lookup for the "recently posted to TikTok" widget on the
-- dashboard / vertical tab strip.
create index if not exists youtube_videos_tiktok_posted_idx
  on public.youtube_videos (user_id, tiktok_posted_at desc)
  where tiktok_posted_at is not null;
