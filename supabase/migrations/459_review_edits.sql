-- REVIEW EDITOR (Seb, 2026-10-30): a review take and a B-roll take in, a
-- finished video out, worked through in the background (overnight for a
-- batch). One row per video. Safe to run twice.
create table if not exists public.review_edits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  -- queued, reading, ready_to_make, making, done, failed
  status text not null default 'queued',
  -- What MVP is doing, or why it stopped, in plain words.
  note text,
  -- { kind: 'upload', url, path, name, bytes }
  review_src jsonb not null,
  broll_src jsonb,
  product text,
  settings jsonb not null default '{}'::jsonb,
  -- The takes as read: { review: { duration, width, height, hasAudio }, broll: {...} }
  info jsonb,
  words jsonb,
  shots jsonb,
  plan jsonb,
  -- { wide?: { url, seconds }, vertical?: { url, seconds } }
  outputs jsonb,
  attempts int not null default 0,
  made_at timestamptz,
  raw_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists review_edits_status_idx on public.review_edits (status, updated_at);
create index if not exists review_edits_user_idx on public.review_edits (user_id, created_at desc);
alter table public.review_edits enable row level security;
drop policy if exists "review_edits own rows" on public.review_edits;
create policy "review_edits own rows" on public.review_edits for select using (auth.uid() = user_id);
