-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Drop six indexes that duplicate a UNIQUE constraint (or the PRIMARY KEY)
-- already covering the same columns on the same table.
--
-- schema:audit's second query (added in migration 322's fix) flags any pair
-- of indexes on one table with the same column list as DUPLICATE. It found
-- six, all the same shape: this migration folder created a plain index for a
-- lookup, and at some later point someone added a UNIQUE constraint over the
-- identical columns directly in the SQL editor, most often so an
-- upsert(..., { onConflict }) had something to target. Postgres backs a
-- UNIQUE constraint with its own index, so from then on every write to that
-- table maintained two indexes doing the same job, and the plain one added
-- nothing a unique index couldn't already serve.
--
-- The unique/primary-key side stays in every case, verified against the app:
--   art_director_briefs (user_id, brief_key)          — lib/art-director-cache.ts upsert onConflict
--   geniuslink_codes    (user_id, asin)                — lib/geniuslink-cache.ts upsert onConflict
--   storefront_snapshots (user_id, period_type, taken_on) — app/api/storefront/ingest upsert onConflict
--   blog_posts           (user_id, video_id)            — no onConflict use found, but the constraint
--                                                          is a real "one post per video" guarantee
--   ig_dm_campaigns      (ig_media_id)                  — same, a real "one campaign per DM" guarantee
--   youtube_video_cache  (user_id)                      — the table's own primary key
--
-- Destructive to the redundant index only, not to any data or constraint.
-- Safe to run twice.

drop index if exists public.art_director_briefs_user_key_idx;
drop index if exists public.blog_posts_user_video_idx;
drop index if exists public.geniuslink_codes_user_asin_idx;
drop index if exists public.ig_dm_campaigns_media_idx;
drop index if exists public.storefront_snapshots_user_idx;
drop index if exists public.youtube_video_cache_user_id_idx;
