-- Migration 398: a job that ran out of attempts is never run again.
--
-- A job left 'running' by a run that died is picked up again after
-- stale_seconds. That branch never looked at the attempt count, so a job
-- allowed one attempt (an admin repair, which rewrites a live post) could be
-- run a second time, paying for a second full rewrite. Now a stale job with
-- no attempts left is marked failed with the reason, and only one with
-- attempts left is picked up again.
--
-- Safe to run twice.

create or replace function public.claim_generation_job(stale_seconds int default 600)
returns setof public.generation_jobs
language plpgsql
as $$
declare
  picked public.generation_jobs;
begin
  update public.generation_jobs
  set status = 'failed',
      error = left(coalesce(error || ' ', '') || 'Stopped: its last allowed attempt never reported back, so it was not run again.', 2000),
      finished_at = now()
  where status = 'running'
    and claimed_at < now() - make_interval(secs => stale_seconds)
    and attempts >= max_attempts;

  select * into picked
  from public.generation_jobs
  where status = 'queued'
     or (status = 'running' and claimed_at < now() - make_interval(secs => stale_seconds) and attempts < max_attempts)
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

  update public.generation_jobs
  set status = 'running', claimed_at = now(), attempts = attempts + 1
  where id = picked.id
  returning * into picked;

  return next picked;
end;
$$;

notify pgrst, 'reload schema';
