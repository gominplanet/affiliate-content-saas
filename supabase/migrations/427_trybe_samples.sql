-- TRYBE samples and the week plan (Seb, 2026-10-13, after Alejandro: "a weekly
-- plan and list of collaborating brands and samples so I have control of who
-- is sending what"). One row per sample a creator asked a brand for. The
-- boxes the creator ticks are the dates: received_at, filmed_at,
-- submitted_at. MVP plans the week from them and keeps each sample's own
-- video ideas in `ideas`.
--
-- Safe to run twice.

create table if not exists public.trybe_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id text,
  brand_name text not null,
  product text not null,
  videos_planned integer not null default 3,
  requested_at timestamptz not null default now(),
  received_at timestamptz,
  filmed_at timestamptz,
  submitted_at timestamptz,
  ideas jsonb,
  ideas_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trybe_samples_user_idx on public.trybe_samples (user_id, created_at desc);

alter table public.trybe_samples enable row level security;

drop policy if exists "own trybe samples" on public.trybe_samples;
create policy "own trybe samples" on public.trybe_samples
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
