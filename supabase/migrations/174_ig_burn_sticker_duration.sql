-- 174_ig_burn_sticker_duration.sql
-- Shop Burner: let the creator choose how long the CTA box stays on screen
-- (5s / 10s / 30s, or 0 = the whole video). The single-video burner passes this
-- straight through to Cloudinary; batch jobs persist it here so the cron worker
-- applies the same window when it renders each queued video.
ALTER TABLE ig_burn_jobs
  ADD COLUMN IF NOT EXISTS sticker_duration_sec integer NOT NULL DEFAULT 0;
