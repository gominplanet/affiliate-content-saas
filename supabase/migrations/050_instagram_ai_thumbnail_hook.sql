-- 050 — Persist the overlay hook alongside the cached IG AI thumbnail.
--
-- The IG modal renders the headline overlay client-side via canvas.
-- When the server returns a cached image (re-open of modal, no new
-- generation), the client also needs the hook so it can re-run the
-- overlay and capture a styleId for the 👍/👎 feedback row. Without
-- this column the cache hit returns the raw image and the feedback
-- buttons never appear.

alter table public.youtube_videos
  add column if not exists instagram_ai_thumbnail_hook text;
