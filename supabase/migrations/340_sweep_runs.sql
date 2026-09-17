-- 340 — sweep_runs: what the hot-linked repair actually did, each time it ran
--
-- /api/cron/rehost-hotlinked repairs published posts every two hours and its
-- report goes to a Vercel log. After two scheduled runs I measured the one
-- affected site reachable from outside and found every post unchanged, and
-- could not tell which of these had happened:
--
--   the cron never fired
--   it fired and errored
--   it fired, tried, and that site refused every upload
--   it fired and worked on creators whose sites I cannot see
--
-- Four very different situations, one identical observation. That is the same
-- defect as the bug being repaired: nothing changed and it worked perfectly
-- look the same from outside.
--
-- So each run writes down what it did. /admin/hotlinked reads the last few, and
-- "the sweep has not run since yesterday" becomes a thing you can see rather
-- than a thing you have to infer.
--
-- The code treats this table as optional: until this SQL is applied the write
-- fails quietly and the repair carries on, so nothing is broken by applying it
-- late. Applying it is what makes the screen useful.
--
-- Safe to run twice.

create table if not exists public.sweep_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null default 'rehost-hotlinked',
  ran_at      timestamptz not null default now(),
  -- false when the sweep could not start at all, which is NOT the same as a run
  -- that started and moved nothing. Those two must never share a row shape.
  ok          boolean not null default true,
  trigger     text not null default 'cron',   -- 'cron' | 'admin'
  owners      integer not null default 0,
  sites       integer not null default 0,
  moved       integer not null default 0,
  refused     integer not null default 0,
  gone        integer not null default 0,
  summary     text,
  error       text,
  results     jsonb
);

create index if not exists sweep_runs_job_ran_at_idx
  on public.sweep_runs (job, ran_at desc);

alter table public.sweep_runs enable row level security;

-- No policies on purpose. Only the service role writes these (the cron and the
-- admin endpoint both use it), and only the admin endpoint reads them back, so
-- no end user ever needs a policy here. RLS on with no policy means a stray
-- anon or authenticated client gets nothing rather than everything.

comment on table public.sweep_runs is
  'One row per run of the hot-linked picture repair. Exists because a run that moved nothing and a run that never happened were indistinguishable from outside.';

comment on column public.sweep_runs.ok is
  'false means the sweep could not start. A run that started and moved nothing is ok=true with moved=0, which is a different fact and must read differently.';

comment on column public.sweep_runs.refused is
  'Pictures the creator''s site would not accept. Their WordPress is the problem and a later run may succeed.';

comment on column public.sweep_runs.gone is
  'Source pictures that no longer exist. No upload or retry fixes these; only regenerating does, which is the creator''s decision.';
