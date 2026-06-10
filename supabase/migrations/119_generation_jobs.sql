-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 119 — generation job queue (Phase 4: async, bulletproof generation).
--
-- Today blog/campaign generation runs synchronously inside the user's request,
-- bounded by Vercel's 300s function limit — the whole pipeline (generate →
-- images → fact-check → citation → self-critique → publish) has to finish
-- before the response returns, and a long transcript can brush the wall (504).
--
-- This table is the substrate for moving that work OFF the request path: the
-- "Generate" action enqueues a row and returns instantly; a once-a-minute cron
-- worker (/api/cron/process-generation-jobs) claims queued rows, runs the work
-- in its own invocation, and records status — so publishing feels instant,
-- failures are observable + retried, and no single user request can time out.
--
-- INCREMENT A (this migration + lib/generation-jobs.ts + the worker): the queue
-- infrastructure. Nothing enqueues jobs yet, so the worker simply finds an
-- empty queue — zero effect on the live synchronous path. INCREMENT B wires the
-- producer (enqueue) + the per-kind handlers + client polling.
--
--   status:  queued → running → done | failed
--   stage:   optional progress label for staged jobs / the polling UI
--   input:   the request params to process (jsonb)
--   result:  output (blog_post_id, wordpress_url, …) once done
--   attempts/max_attempts: retry budget (the worker re-queues on transient fail)

create table if not exists public.generation_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,          -- who triggered it (caps + telemetry)
  owner_id     uuid not null,          -- whose resources it acts on (VA two-tier)
  kind         text not null,          -- 'blog' | 'comparison' | 'campaign' (extensible)
  status       text not null default 'queued',
  stage        text,
  input        jsonb not null default '{}'::jsonb,
  result       jsonb,
  error        text,
  attempts     int  not null default 0,
  max_attempts int  not null default 3,
  claimed_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);

-- Worker claim path: oldest queued first (partial index keeps it tiny).
create index if not exists generation_jobs_claim_idx
  on public.generation_jobs (created_at)
  where status = 'queued';
-- Stale-running recovery (a worker that died mid-job).
create index if not exists generation_jobs_stale_idx
  on public.generation_jobs (claimed_at)
  where status = 'running';
-- Per-user history (the polling UI + a future jobs dashboard).
create index if not exists generation_jobs_user_idx
  on public.generation_jobs (user_id, created_at desc);

-- updated_at bump on every write.
create or replace function public.touch_generation_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_generation_jobs_updated_at on public.generation_jobs;
create trigger trg_generation_jobs_updated_at
  before update on public.generation_jobs
  for each row execute function public.touch_generation_jobs_updated_at();

-- Atomic claim. Grabs the oldest queued job (or a running job whose worker went
-- stale), flips it to running, bumps attempts — all under FOR UPDATE SKIP LOCKED
-- so two concurrent cron ticks can never grab the same row. Returns the claimed
-- row, or no rows when the queue is empty.
create or replace function public.claim_generation_job(stale_seconds int default 600)
returns setof public.generation_jobs
language plpgsql
as $$
declare
  picked public.generation_jobs;
begin
  select * into picked
  from public.generation_jobs
  where status = 'queued'
     or (status = 'running' and claimed_at < now() - make_interval(secs => stale_seconds))
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

-- Claim path is service-role-only. The worker calls this with the service key
-- (which bypasses grants); revoke EXECUTE from normal clients so a user-scoped
-- session can't invoke the claim/UPDATE path at all. Defense-in-depth: today
-- RLS already blocks the internal UPDATE for non-service roles, but this
-- removes the surface entirely (matches the "writes via service role only" design).
revoke all on function public.claim_generation_job(int) from public, anon, authenticated;

-- RLS: an owner and their accepted VAs can READ jobs. Writes happen only via
-- the worker (service-role admin client) and the server-side enqueue route —
-- no client INSERT/UPDATE/DELETE policies, same guardrail as migration 116.
alter table public.generation_jobs enable row level security;
drop policy if exists generation_jobs_select on public.generation_jobs;
create policy generation_jobs_select on public.generation_jobs
  for select using (
    user_id = auth.uid() or public.is_accepted_member_of(owner_id)
  );

comment on table public.generation_jobs is
  'Async generation queue (Phase 4). Producer enqueues; the once-a-minute cron worker /api/cron/process-generation-jobs claims + runs jobs off the request path. Reads owner+VA scoped; writes via service role only.';
