-- 383: Amazon storefront uploads try again on their own.
--
-- A failed listing (a slow upload, a tab still loading, a store this Chrome was
-- not signed in to yet) used to stay failed until somebody pressed Send again.
-- Now each failure counts a try and, unless Amazon itself refused it, carries
-- the time of the next try. The delivery queue offers it again at that time,
-- up to five tries.
--
-- Safe to run twice.
alter table public.global_sync_targets add column if not exists upload_tries integer not null default 0;
alter table public.global_sync_targets add column if not exists next_try_at timestamptz;
create index if not exists global_sync_targets_retry_idx
  on public.global_sync_targets (user_id, next_try_at)
  where state = 'failed' and next_try_at is not null;
notify pgrst, 'reload schema';
