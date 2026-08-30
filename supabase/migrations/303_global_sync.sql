-- 303_global_sync.sql
-- Global Storefront Sync: one master video, localized and delivered to every
-- Amazon marketplace the creator sells in. This migration is the job model.
--
-- A job is one master video the creator wants distributed. Each target is one
-- marketplace: its language, whether it needs a dub, the localized title and
-- description, the regional ASIN, and the delivery state. The localization
-- pipeline (Milestone 2) fills in the assets; the SCOUT fan-out (Milestone 3)
-- moves each target through pending -> localized -> delivered.

create table if not exists public.global_sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  video_id        uuid,                       -- youtube_videos.id (the master)
  asin            text,                       -- the featured product
  status          text not null default 'queued', -- queued|localizing|delivering|done|failed
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.global_sync_targets (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.global_sync_jobs(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  domain          text not null,              -- amazon.co.uk
  lang            text not null,              -- de-DE
  dub             boolean not null default false,
  asin            text,                       -- regional ASIN (validated per host)
  title           text,
  description     text,
  video_url       text,                       -- localized (captioned/dubbed) master
  captions_url    text,
  state           text not null default 'pending', -- pending|localized|delivered|failed
  detail          text,
  delivered_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (job_id, domain)
);

create index if not exists global_sync_jobs_user_idx on public.global_sync_jobs (user_id, created_at desc);
create index if not exists global_sync_targets_job_idx on public.global_sync_targets (job_id);

alter table public.global_sync_jobs    enable row level security;
alter table public.global_sync_targets enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='global_sync_jobs' and policyname='own sync jobs') then
    create policy "own sync jobs" on public.global_sync_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='global_sync_targets' and policyname='own sync targets') then
    create policy "own sync targets" on public.global_sync_targets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

notify pgrst, 'reload schema';
