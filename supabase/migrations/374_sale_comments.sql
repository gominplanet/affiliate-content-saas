-- Migration 374: the sale comments MVP posted, so it can take the sale out,
-- and what was shared to socials from "On sale now".
--
-- A comment that says "on sale right now" stays on the video after the sale
-- ends, and then it says something untrue. Every comment MVP posts is kept
-- here with a second version written at the same time that has no sale in
-- it. When the sale ends, a job edits the comment on YouTube to that second
-- version: the comment, its link and its pin stay; only the sale goes.
--
-- state:
--   on_sale   posted, the sale is still on (or not checked since)
--   updated   the sale ended and the comment was edited to the lasting version
--   gone      the comment is no longer on YouTube (deleted), nothing to edit
--   failed    the edit was tried and YouTube refused; last_error says why
--
-- pinned: null until SCOUT tries to pin it, then true or false with pin_error.
--
-- Safe to run twice.

create table if not exists public.sale_comments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  asin             text not null,
  youtube_video_id text not null,
  video_title      text,
  channel_id       text,
  comment_id       text not null,
  sale_text        text not null,
  lasting_text     text not null,
  sale_label       text,
  state            text not null default 'on_sale',
  pinned           boolean,
  pin_error        text,
  last_error       text,
  last_checked_at  timestamptz,
  posted_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists sale_comments_user_idx on public.sale_comments (user_id, posted_at desc);
create index if not exists sale_comments_live_idx on public.sale_comments (state, last_checked_at) where state = 'on_sale';
alter table public.sale_comments enable row level security;
drop policy if exists "sale_comments_own_read" on public.sale_comments;
create policy "sale_comments_own_read" on public.sale_comments
  for select to authenticated using (user_id = auth.uid());

-- WHAT WAS SHARED FROM "ON SALE NOW", so each product can say it was already
-- posted to socials. Written by the posting route itself from what the
-- platforms actually answered: ok_platforms lists only the ones that took
-- the post. A scheduled post is recorded as scheduled, with its time.
create table if not exists public.on_sale_shares (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  asin          text not null,
  ok_platforms  text[] not null default '{}',
  failed_platforms text[] not null default '{}',
  scheduled_for timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists on_sale_shares_user_idx on public.on_sale_shares (user_id, asin, created_at desc);
alter table public.on_sale_shares enable row level security;
drop policy if exists "on_sale_shares_own_read" on public.on_sale_shares;
create policy "on_sale_shares_own_read" on public.on_sale_shares
  for select to authenticated using (user_id = auth.uid());
