-- 234 — Bounded retries for transient publish failures on scheduled posts.
--
-- The scheduled social cron marked EVERY publish error as 'failed' with no
-- retry, so a single ECONNRESET / 5xx / timeout killed the post permanently (and
-- three such blips also falsely tripped the dead-channel "reconnect" nag). This
-- adds a retry counter so a transient error requeues the row (status back to
-- 'pending') for the next tick instead of dying, capped so it can't loop forever.

alter table public.scheduled_posts
  add column if not exists retry_count integer not null default 0;

notify pgrst, 'reload schema';
