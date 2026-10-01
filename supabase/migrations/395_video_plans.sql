-- Migration 395: Plan this video (Labs, admin while it is tested).
--
-- One plan per joined Creator Connections campaign product: the angle, titles,
-- opening line, outline, shots, the Short to cut, the thumbnail and the dates
-- worked back from the campaign end. A plan counts as made only when a video
-- for that product actually exists on the channel (checked when read), never
-- because a button was pressed.
--
-- Safe to run twice.

create table if not exists public.video_plans (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  asin         text not null,
  campaign_id  text,
  brand        text,
  product      text,
  ends_at      date,
  plan         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists video_plans_user_idx on public.video_plans (user_id, created_at desc);
create index if not exists video_plans_user_asin_idx on public.video_plans (user_id, asin);

alter table public.video_plans enable row level security;
drop policy if exists "own video plans" on public.video_plans;
create policy "own video plans" on public.video_plans
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
