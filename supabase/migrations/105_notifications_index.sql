-- Migration 105: Index for notification-bell polling.
--
-- /api/notifications queries scheduled_posts filtered by user_id +
-- status in ('completed','failed') + updated_at >= 7-days-ago, ordered
-- by updated_at desc. Polled every 60s by every signed-in user via the
-- topbar bell.
--
-- The existing indexes from migration 021 are scheduled_posts_due_idx
-- (partial on status='pending') and scheduled_posts_user_idx
-- (user_id, scheduled_at desc). Neither matches the bell's filter
-- shape, so the query was a sequential scan as the table grows.
--
-- This partial index covers the exact filter — small footprint
-- (only completed+failed rows) + ordered for the bell's `desc` sort.
create index if not exists scheduled_posts_user_recent_idx
  on public.scheduled_posts (user_id, updated_at desc)
  where status in ('completed', 'failed');

-- Also add a non-partial updated_at index to speed up /admin/cron-stats
-- which filters by updated_at >= 24h-ago WITHOUT a status restriction.
-- That route is polled every 30s by admins on the dashboard.
create index if not exists scheduled_posts_updated_at_idx
  on public.scheduled_posts (updated_at desc);
