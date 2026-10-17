-- 437 Drop: every other place a dropped video goes, and the Launch plans a
-- creator sets once (Labs, admin while it is tested; Seb, 2026-10-17: "make
-- sure that this drop feature is able to do YouTube, Amazon, everything that
-- we talked about").
--
-- ONE ROW PER VIDEO PER PLACE (TikTok, Instagram, Shorts, a Facebook Reel, a
-- pin, a Facebook Group post, clips). The wish is the row; the result is its
-- state, written only after the engine that did the work answered. Each row is
-- claimed (wanted to sending) before it runs, so the Drop page and SCOUT's
-- background tab never post one video twice.
--
-- A LAUNCH PLAN is where each kind of video goes unless the creator says
-- otherwise on the day: long videos to these places, vertical ones to those.
--
-- Safe to run more than once.

create table if not exists public.drop_sends (
  id            uuid primary key default gen_random_uuid(),
  drop_item_id  uuid not null references public.drop_items(id) on delete cascade,
  drop_id       uuid not null references public.drops(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  place         text not null,
  -- wanted | sending | done | failed | needs_you
  state         text not null default 'wanted',
  detail        text,
  url           text,
  ref_id        text,
  payload       jsonb not null default '{}'::jsonb,
  at            timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (drop_item_id, place)
);

create index if not exists drop_sends_drop_idx on public.drop_sends (drop_id);
create index if not exists drop_sends_open_idx on public.drop_sends (user_id, state) where state in ('wanted', 'sending', 'needs_you');

create table if not exists public.drop_plans (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  plans       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Written by MVP's server after it checks the creator; each creator may read
-- their own.
alter table public.drop_sends enable row level security;
alter table public.drop_plans enable row level security;

drop policy if exists "own drop sends" on public.drop_sends;
create policy "own drop sends" on public.drop_sends
  for select using (auth.uid() = user_id);

drop policy if exists "own drop plans" on public.drop_plans;
create policy "own drop plans" on public.drop_plans
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
