-- Facebook posts waiting for the creator's Group (Seb, 2026-10-13: scheduled
-- and auto-pilot Facebook posts "queue for the Group"). Facebook lets nobody
-- but the creator press Post in a Group, so a post made while they are away
-- waits here instead of going on the Page with the link. From the Facebook
-- hub, Send has SCOUT fill the Group post, the creator presses Post, and MVP
-- posts on the Page pointing to it.
--
-- source: 'scheduled' (a blog review), 'deal', 'amazon_design', 'deal_scheduled',
-- 'amazon_scheduled'. status: 'waiting', 'sent' or 'dismissed'.
--
-- Safe to run twice.

create table if not exists public.facebook_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  source_id text,
  title text,
  body text not null,
  link text,
  image_url text,
  status text not null default 'waiting',
  group_post_url text,
  page_post_url text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists facebook_queue_user_status on public.facebook_queue (user_id, status, created_at desc);

alter table public.facebook_queue enable row level security;

drop policy if exists "own facebook queue" on public.facebook_queue;
create policy "own facebook queue" on public.facebook_queue
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
