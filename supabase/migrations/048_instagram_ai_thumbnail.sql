-- 048 — Native Instagram AI thumbnail (Pro-only)
--
-- The Instagram publish flow now offers a third image-source option:
-- "Generate a native 4:5 AI image" that's specifically composed for IG
-- (portrait orientation, face + product front-and-centre, IG-tuned
-- prompt). Pro-only, separately capped from YouTube thumbnails.
--
-- We persist the resulting URL on youtube_videos so re-opening the IG
-- modal for the same video doesn't burn another generation credit —
-- the user can re-use what they already paid for.

alter table public.youtube_videos
  add column if not exists instagram_ai_thumbnail_url text,
  add column if not exists instagram_ai_thumbnail_generated_at timestamptz;

create index if not exists yt_videos_user_ig_thumb_idx
  on public.youtube_videos (user_id, instagram_ai_thumbnail_generated_at desc)
  where instagram_ai_thumbnail_url is not null;
