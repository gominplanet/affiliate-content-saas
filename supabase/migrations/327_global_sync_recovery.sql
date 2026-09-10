-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Let a stalled Storefront Sync be recovered, and say why when it cannot be.
--
-- /api/global-sync/start localizes each market in work scheduled AFTER the
-- response is returned. On Vercel the function can be frozen the moment the
-- response goes out, so that work is not guaranteed to run. Nothing reconciled
-- the outcome: no cron touched these tables, and the failure path wrote
-- status='failed' with no reason attached.
--
-- Production had four jobs stuck in 'localizing' against 27 that finished, the
-- oldest sitting since 1 September. Roughly one run in eight left a creator
-- watching a spinner that was never going to resolve, and MVP could not tell
-- them anything about it.
--
-- Two columns and an index:
--   error             why a job stopped, in words, for the page to show
--   recovery_attempts how many times the cron has retried it, so a job that
--                     fails for its own reasons is not retried every minute
--                     forever, spending model calls on each pass
--   the index         the cron's claim query: unfinished jobs, oldest first
--
-- The final statement closes out the jobs already stranded. They are marked
-- failed rather than resumed on purpose: their videos are more than a week old,
-- and delivering week-old localized titles into live storefronts is worse than
-- delivering nothing. The reason is written where the creator will read it.
--
-- Additive apart from that one status change. Safe to run twice: the update
-- only matches jobs that are still stuck, so a second run matches nothing.

alter table if exists public.global_sync_jobs
  add column if not exists error text,
  add column if not exists recovery_attempts integer not null default 0;

comment on column public.global_sync_jobs.error is
  'Why this sync stopped, in words the creator can act on. Null while healthy. The original failure path set status=failed and left this unset, which is how a dead job ends up explaining nothing.';

comment on column public.global_sync_jobs.recovery_attempts is
  'How many times the recovery cron has picked this job up. Incremented BEFORE the work, so a job that dies every time still stops being retried.';

-- The cron's claim: unfinished jobs, oldest-touched first.
create index if not exists global_sync_jobs_recovery_idx
  on public.global_sync_jobs (updated_at)
  where status in ('queued', 'localizing', 'delivering');

-- Close out the jobs stranded before the recovery cron existed.
update public.global_sync_jobs
set status = 'failed',
    error = 'This sync stalled before MVP could finish localizing it, and sat long enough that its titles would now be out of date. Nothing was delivered to your storefronts. Start the sync again when you want the video out.',
    updated_at = now()
where status in ('queued', 'localizing', 'delivering')
  and updated_at < now() - interval '24 hours';

notify pgrst, 'reload schema';
