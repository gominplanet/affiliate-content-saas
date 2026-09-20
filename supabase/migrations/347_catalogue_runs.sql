-- 347 — catalogue_runs / catalogue_run_items: the back catalogue, delivered.
--
-- YouTube auto-dubs a sizeable slice of a creator's channel. One creator's
-- count: 197 of 525 videos already carry a German track. Those are 197 listings
-- that could be on amazon.de today, already translated, already timed to the
-- picture, at no dub cost.
--
-- Until now MVP only ever looked at ONE video, at the moment it was being
-- published. Nothing could see the back catalogue.
--
-- NOT A DOWNLOADER. The obvious shape for this is a bulk export: scan the
-- channel, fetch the dubbed files, hand the creator a folder. That is a to-do
-- list, not a feature. They would still have to open Creator Hub, pick the
-- marketplace, upload, retype the title and attach the ASIN, which is nearly all
-- of the work and precisely what MVP exists to remove. So a run ends in
-- storefront listings and the creator never sees an MP4.
--
-- A run is per (user, marketplace) and holds one item per video, because the
-- interesting part is the videos it CANNOT deliver: 197 delivered and 328
-- explained is a useful answer, 37% is not.
--
-- Safe to run more than once.

create table if not exists public.catalogue_runs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- The Amazon marketplace this run targets, e.g. 'amazon.de'. Matches
  -- lib/markets and the global-sync domain key.
  domain      text not null,
  -- queued → scanning → ready (every item resolved) → failed
  state       text not null default 'queued',
  detail      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists catalogue_runs_user_idx
  on public.catalogue_runs (user_id, created_at desc);

-- One row per video considered, INCLUDING the ones that turn out to be
-- ineligible. Dropping those would leave a run reporting a number with no way
-- to find out what happened to the rest.
create table if not exists public.catalogue_run_items (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references public.catalogue_runs(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  video_id          uuid not null references public.youtube_videos(id) on delete cascade,
  youtube_video_id  text,
  -- pending → eligible | skipped | queued | delivered | failed
  state             text not null default 'pending',
  -- Why it was skipped, in words. 'no German audio track on this video' and
  -- 'no product attached' send a creator to do completely different things, so
  -- a bare skipped state would be useless.
  reason            text,
  -- The storefront sync job created for this video once it qualified, so the
  -- existing pipeline does the localizing and the upload.
  sync_job_id       uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- A video appears once per run. Re-running the scan updates the row rather
  -- than adding a second verdict for the same video.
  unique (run_id, video_id)
);

create index if not exists catalogue_run_items_run_idx
  on public.catalogue_run_items (run_id, state);

-- The scan worker's claim query: the oldest pending item across all runs.
create index if not exists catalogue_run_items_pending_idx
  on public.catalogue_run_items (state, created_at)
  where state = 'pending';

alter table public.catalogue_runs enable row level security;
alter table public.catalogue_run_items enable row level security;

drop policy if exists "catalogue_runs_owner_all" on public.catalogue_runs;
create policy "catalogue_runs_owner_all" on public.catalogue_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "catalogue_run_items_owner_all" on public.catalogue_run_items;
create policy "catalogue_run_items_owner_all" on public.catalogue_run_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.catalogue_runs is
  'A back-catalogue push: every video on a creator''s channel that already carries the target market''s language, delivered to that storefront through the normal sync pipeline. Ends in listings, never in downloaded files.';

comment on column public.catalogue_run_items.reason is
  'Why this video is not being delivered, in words. The skipped videos are the useful half of the report: "no German track" and "no product attached" are different problems with different fixes.';
