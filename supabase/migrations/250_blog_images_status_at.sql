-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 250 — Timestamp for the blog image pass, to reconcile stuck rows
--
-- blog/generate sets images_status='pending' before its (deferred) image pass.
-- On an interactive request that pass runs inside Vercel's after() callback,
-- which Vercel can truncate once the response is sent — killing the process
-- before it writes a terminal 'ready'/'failed'. The row then sits on 'pending'
-- forever, and the dashboard shows an eternal "Images…" spinner that the user
-- (especially Trial/Creator, who can't reach the Pro-gated re-roll) can't clear.
--
-- This adds a timestamp stamped when the row goes 'pending', so a cron can tell
-- a genuinely-stuck row (pending for >20 min) from one whose pass is still
-- running, and flip only the stuck ones to a terminal 'failed'.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.blog_posts
  add column if not exists images_status_at timestamptz;

-- Reconcile lookup: find pending rows older than the cutoff quickly.
create index if not exists blog_posts_images_status_pending_idx
  on public.blog_posts (images_status_at)
  where images_status = 'pending';
