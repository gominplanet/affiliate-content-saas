-- Migration 063: Instagram Burner batch/schedule job queue
--
-- One row per uploaded video in a batch. A per-minute cron
-- (/api/cron/process-burn-jobs) picks up due rows (scheduled_at <= now,
-- status='pending'), burns the caption, composes the Reel caption, publishes
-- the Reel to the user's Instagram, and marks the row completed/failed.

create table if not exists public.ig_burn_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_video_url text not null,
  caption_text text not null default 'LINK IN BIO',
  style text not null default 'white-pill',
  position text not null default 'lower-third',
  product text,
  scheduled_at timestamptz not null default now(),
  status text not null default 'pending', -- pending | processing | completed | failed
  result_url text,
  reel_caption text,
  ig_published boolean not null default false,
  error_message text,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.ig_burn_jobs enable row level security;

-- Users manage only their own jobs. The cron uses the service-role client,
-- which bypasses RLS, so no policy is needed for the worker.
drop policy if exists "ig_burn_jobs_select_own" on public.ig_burn_jobs;
create policy "ig_burn_jobs_select_own" on public.ig_burn_jobs
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "ig_burn_jobs_insert_own" on public.ig_burn_jobs;
create policy "ig_burn_jobs_insert_own" on public.ig_burn_jobs
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "ig_burn_jobs_delete_own" on public.ig_burn_jobs;
create policy "ig_burn_jobs_delete_own" on public.ig_burn_jobs
  for delete to authenticated using (user_id = auth.uid());

create index if not exists ig_burn_jobs_user_idx on public.ig_burn_jobs (user_id, created_at desc);
create index if not exists ig_burn_jobs_due_idx on public.ig_burn_jobs (status, scheduled_at);
