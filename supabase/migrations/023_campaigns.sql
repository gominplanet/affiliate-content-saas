-- Migration 023: Creator Connections campaign posts
--
-- A second content engine for the MVP Affiliate add-on. Unlike the
-- YouTube pipeline (transcript-derived), a campaign post is built from
-- an Amazon ASIN + extensive web research → an SEO/FAQ/problem-solution
-- blog in the user's brand voice. Powers the (Phase 1) /campaigns page
-- and later the Chrome extension hand-off.
--
-- `epc` / `ends_at` are optional campaign metadata (filled by the user
-- now, by the extension in Phase 2) so the dashboard can show
-- "commission boost active until <date>".

create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  asin          text not null,
  product_title text,
  campaign_name text,
  epc           text,                 -- free text e.g. "12% boost" — Amazon has no API for this
  ends_at       date,                 -- campaign window end, if known
  status        text not null default 'pending' check (status in (
                  'pending', 'researching', 'generating', 'published', 'failed'
                )),
  error_message text,
  blog_post_id  uuid references public.blog_posts(id) on delete set null,
  wordpress_url text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists campaigns_user_idx
  on public.campaigns (user_id, created_at desc);

alter table public.campaigns enable row level security;

drop policy if exists "campaigns_select_own" on public.campaigns;
create policy "campaigns_select_own" on public.campaigns
  for select using (auth.uid() = user_id);

drop policy if exists "campaigns_insert_own" on public.campaigns;
create policy "campaigns_insert_own" on public.campaigns
  for insert with check (auth.uid() = user_id);

drop policy if exists "campaigns_update_own" on public.campaigns;
create policy "campaigns_update_own" on public.campaigns
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
