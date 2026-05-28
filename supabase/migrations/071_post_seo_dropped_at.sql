-- 071 — Track when a post is de-indexed by Google
--
-- Adds a `dropped_at` timestamp to post_seo so we can surface the rare-but-real
-- case where Google drops a previously-indexed post from the index. The daily
-- cron /api/cron/refresh-indexing stamps it the moment indexed_state flips
-- from 'indexed' → 'not_indexed', and clears it when the post comes back.
--
-- The SEO page reads this to show a "N posts dropped in the last 7 days"
-- banner + a per-row "Recently dropped" pill on affected posts, so creators
-- can investigate (broken links, canonical mismatch, manual action, etc.).

alter table public.post_seo
  add column if not exists dropped_at timestamptz;

-- Partial index for the "recent drops" query (small, fast). Only indexes rows
-- where dropped_at is set, which is rare (most posts stay indexed once they
-- get in), so the index stays tiny.
create index if not exists post_seo_dropped_at_idx
  on public.post_seo(user_id, dropped_at)
  where dropped_at is not null;
