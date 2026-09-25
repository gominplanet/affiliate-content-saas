-- Migration 376: "My features", the sidebar features a creator pinned.
--
-- Each creator can star the features they use most, and those sit in their
-- own section at the top of the sidebar. Stored per account so the list
-- follows them to every browser and device. `hrefs` is the pinned pages in
-- the order they were pinned.
--
-- Safe to run twice.

create table if not exists public.user_nav_favorites (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  hrefs      text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.user_nav_favorites enable row level security;
drop policy if exists "user_nav_favorites_own" on public.user_nav_favorites;
create policy "user_nav_favorites_own" on public.user_nav_favorites
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
