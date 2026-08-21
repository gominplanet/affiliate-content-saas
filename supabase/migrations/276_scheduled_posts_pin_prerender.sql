-- 276 — Pre-rendered Pinterest pin image on a scheduled post.
--
-- Auto-pilot Pinterest pins used to ship the raw YouTube thumbnail because the
-- polished "art-director" pin is built at fire time under a 30s budget on the
-- 60s publish cron, and usually lost that race. Now a dedicated cron
-- (/api/cron/prerender-pins) builds the designed pin AHEAD of the scheduled
-- time — where it has real time budget — and stores it here; the publish cron
-- then just posts the finished image, no race.
--
--   image_data       — the composed pin JPEG as base64 (nulled after send / for
--                      non-pinterest rows). Transient; the row is short-lived.
--   image_media_type — the mime ('image/jpeg'), OR the sentinel 'rendering'
--                      while a pre-render is in flight (a claim marker so two
--                      cron ticks never render the same row). image_data stays
--                      null until the render finishes, so the publish cron only
--                      trusts a row whose image_data is actually set.
-- Idempotent.

alter table public.scheduled_posts
  add column if not exists image_data text,
  add column if not exists image_media_type text;

notify pgrst, 'reload schema';
