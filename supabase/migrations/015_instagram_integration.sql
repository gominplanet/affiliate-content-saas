-- Migration 015: Add Instagram integration columns
--
-- Instagram fan-out uses the new Instagram API (with Instagram Login),
-- not the older Facebook-Login-via-Page path. Each user connects their
-- own Instagram Business/Creator account via OAuth; we store a long-lived
-- access token (60 days) plus their IG user ID and username.
--
-- The user also uploads (or pastes a YouTube Short URL for, v2) a
-- vertical 9:16 MP4 per video. We host it in Supabase Storage and
-- give Instagram a public URL via the Content Publishing API.
--
-- Per Instagram Graph API constraints:
--   - Reels publishing: caption + hashtags, no clickable links (IG-wide)
--   - Stories publishing: video posts BUT link stickers can't be added
--     via API — user adds the sticker manually on phone after publish

alter table public.integrations
  add column if not exists instagram_user_id      text,
  add column if not exists instagram_username     text,
  add column if not exists instagram_access_token text,
  add column if not exists instagram_token_expiry bigint;

-- Per-video vertical MP4 the user uploads for Instagram publishing.
-- Stored as a public Supabase Storage URL that Instagram can fetch.
alter table public.youtube_videos
  add column if not exists instagram_video_url text;

-- Publish ids — separate tracking for Reel vs Story since user can do both
alter table public.blog_posts
  add column if not exists instagram_reel_id  text,
  add column if not exists instagram_story_id text;

-- Storage bucket for vertical Instagram videos (run separately in Supabase
-- dashboard → Storage → Create bucket OR via the SQL below if you have
-- the storage extension exposed):
--
--   insert into storage.buckets (id, name, public)
--     values ('instagram-videos', 'instagram-videos', true)
--     on conflict (id) do nothing;
--
-- Public read so Instagram's CDN can fetch the video URL during publish.
-- Files are user-uploaded content (their own MP4s) — public is fine.
