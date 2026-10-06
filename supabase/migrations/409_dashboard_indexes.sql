-- 409: Indexes for dashboard reads that sorted or filtered without one.
--
-- Each index below names the page and the query it serves. All three are
-- plain btree indexes on columns the queries already filter and order by; no
-- query changes are needed for Postgres to pick them up.
--
-- Safe to run twice.

set statement_timeout = 0;

-- Brand campaigns (/cc-campaigns, GET /api/cc/campaigns), "Has open spots" on,
-- which is the default.
--   1. The headline count: live campaigns with open spots
--      (ends_at >= today, commission_pct > 0, available_slot > 0). Migration
--      326's (ends_at, commission_pct) index carries two of the three
--      predicates, so every live row was still read from the table to check
--      available_slot, and on about 900,000 rows the exact count could run to
--      the statement timeout before the route fell back to an estimate.
--      Partial on available_slot > 0, this count is an index-only scan.
--   2. The "Ending soonest" sort: the same filters ordered by ends_at, which
--      walks this index in order and stops at 1,000.
create index if not exists cc_catalog_open_ends_commission_idx
  on public.cc_campaign_catalog (ends_at, commission_pct)
  where available_slot > 0;

-- Blog posts (/content), the failed-schedule badges: this creator's
-- scheduled_posts from the last 30 days, newest updated_at first, 500 at most,
-- with no status filter. scheduled_posts_user_recent_idx only covers
-- completed and failed rows, so it cannot serve a read that also wants pending
-- ones; Postgres read every row this creator ever scheduled and sorted them.
create index if not exists scheduled_posts_user_updated_idx
  on public.scheduled_posts (user_id, updated_at desc);

-- Blog posts (/content) video list, Clip Factory, Meta Hub, Pinned Comments'
-- video picker and the daily Creator Connections digest: this creator's
-- youtube_videos ordered by published_at desc NULLS LAST. The existing
-- idx_youtube_videos_user_published is (user_id, published_at desc), which is
-- NULLS FIRST, so it cannot give that order: each read fetched and sorted the
-- creator's whole catalogue, and the Library does that four times over (1,000
-- rows per page, up to 4,000). This one matches the order the app asks for.
create index if not exists youtube_videos_user_published_nl_idx
  on public.youtube_videos (user_id, published_at desc nulls last);

analyze public.cc_campaign_catalog;
analyze public.scheduled_posts;
analyze public.youtube_videos;
