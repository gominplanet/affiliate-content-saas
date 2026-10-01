-- Migration 394: Amazon Live follow-up (Labs, admin while it is tested).
--
-- One row per Live replay a creator follows up on. SCOUT reads the replay page
-- (stream address and products shown), MVP transcribes the audio, finds the
-- moment each product was shown, and cuts one vertical clip per product.
-- Nothing posts by itself: the clips open in Clip Factory as drafts.
--
-- state: read (SCOUT found the stream) -> transcribed -> matched
-- moments: [{ asin, title, startSec, endSec, hook, clipUrl?, clipError? }]
-- missing: [{ asin, title }] products in the plan not found in the replay
--
-- Safe to run twice.

create table if not exists public.live_followups (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  plan_id       uuid references public.live_plans(id) on delete set null,
  replay_url    text not null,
  title         text,
  stream_url    text,
  streams       jsonb not null default '[]',
  page_asins    text[] not null default '{}',
  duration_sec  integer,
  audio_url     text,
  cues          jsonb,
  moments       jsonb not null default '[]',
  missing       jsonb not null default '[]',
  state         text not null default 'read',
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists live_followups_user_idx on public.live_followups (user_id, created_at desc);

alter table public.live_followups enable row level security;
drop policy if exists "own live followups" on public.live_followups;
create policy "own live followups" on public.live_followups
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
