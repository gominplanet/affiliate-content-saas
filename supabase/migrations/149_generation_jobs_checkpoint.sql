-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 149 — generation_jobs.checkpoint (money-safety: stop re-billing Opus
-- on retry).
--
-- THE LEAK: a blog/campaign job runs the expensive Opus writer FIRST, then does
-- the slow WordPress publish LAST. On a host with a slow WAF, the publish blows
-- the worker's ~290s budget → the job is left 'running' → the 600s stale-claim
-- re-runs the ENTIRE route, re-paying for a full Opus generation. Capped at
-- max_attempts (3), so one timing-out post could pay for Opus up to 3×. A user
-- repeatedly hitting Rebuild on a slow host multiplies that into a real spend
-- spike (observed 2026-07-02).
--
-- THE FIX: checkpoint the writer's output onto the job the instant it's
-- produced, BEFORE the publish. On any retry the route loads the checkpoint and
-- SKIPS the Opus call — it only re-runs the cheap post-processing + the publish.
-- That (a) eliminates the re-bill, and (b) gives the retry the whole 290s budget
-- for just the publish, so a slow-host post actually lands instead of looping.
--
-- Nullable jsonb, written by the service-mode generate route via the admin
-- client; never read by clients (RLS on the table already restricts reads to the
-- owner + accepted VAs, and this column carries no new sensitive data).

alter table public.generation_jobs
  add column if not exists checkpoint jsonb;

comment on column public.generation_jobs.checkpoint is
  'Cached generator output (the Opus writer result) persisted mid-run, BEFORE the WordPress publish, so a retry after a publish timeout reuses it instead of re-billing a fresh Opus generation. Written by the service-mode generate route; cleared/ignored once the job is terminal.';
