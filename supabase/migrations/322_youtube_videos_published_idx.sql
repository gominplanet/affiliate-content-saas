-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Index the read that every video screen actually performs.
--
-- The hot query shape across the app is "this creator's videos, newest first":
--
--   .from('youtube_videos').eq('user_id', …).order('published_at', desc)
--
-- It backs the Content page (which pulls up to 4,000 rows in one go), the
-- dashboard, the Creator Connections digest and the Instagram burn picker.
--
-- youtube_videos carries two composite indexes today, (user_id,
-- tiktok_posted_at desc) and (user_id, instagram_posted_at desc). Postgres can
-- use either for the user_id equality, but neither provides the published_at
-- ordering, so the sort is a separate step over every row that creator owns.
-- For an account with thousands of synced videos that is the difference between
-- an index scan and a full sort on each page load.
--
-- Safe to run twice (if not exists).
--
-- Note on locking: a plain CREATE INDEX takes a SHARE lock, which blocks writes
-- to youtube_videos while it builds. On a table of this size that is seconds,
-- and video sync is not continuous, so this is fine to run live. If the table
-- has grown past a few hundred thousand rows, run the CONCURRENTLY variant in
-- the comment below INSTEAD — it cannot run inside a transaction block, so it
-- must be the only statement you execute.
--
--   create index concurrently if not exists youtube_videos_user_published_idx
--     on public.youtube_videos (user_id, published_at desc);

create index if not exists youtube_videos_user_published_idx
  on public.youtube_videos (user_id, published_at desc);

comment on index public.youtube_videos_user_published_idx is
  'Serves the app-wide "this creator''s videos, newest first" read: Content page, dashboard, CC digest, Instagram burn picker. The pre-existing composites cover user_id but order by a posted_at column, so they leave the published_at sort to be done separately.';
