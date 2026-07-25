-- 179 — Shorts Studio: remember where each rendered Short was published.
--
-- When a creator cross-posts a rendered clip to TikTok / Instagram / YouTube,
-- stamp the time so the UI can flip that platform's pill to a "posted" state
-- (and keep it that way across reloads). Null = not yet posted there.

ALTER TABLE youtube_shorts
  ADD COLUMN IF NOT EXISTS posted_tiktok    timestamptz,
  ADD COLUMN IF NOT EXISTS posted_instagram timestamptz,
  ADD COLUMN IF NOT EXISTS posted_youtube   timestamptz;
