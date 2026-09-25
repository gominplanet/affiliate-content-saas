-- Migration 377: the first comment Co-Pilot posts and pins on each video.
--
-- When a creator pushes a video with Co-Pilot, its suggested pinned comment is
-- queued here. YouTube does not take comments on a private or scheduled
-- video, so a job posts it the moment the video is public, and SCOUT pins it
-- in the creator's own browser (YouTube has no pin API). Encore later edits
-- this same comment to add a sale, so a video keeps one pinned comment.
--
-- state:
--   waiting   queued, the video is not public yet
--   posted    on the video; comment_id says which
--   failed    YouTube refused, or the video cannot be seen; last_error says why
--   cancelled the creator switched it off before it was posted
--
-- pinned: null until SCOUT tries, then true or false with pin_error.
--
-- Safe to run twice.

create table if not exists public.video_first_comments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  youtube_video_id text not null,
  channel_id       text,
  video_title      text,
  text             text not null,
  state            text not null default 'waiting',
  comment_id       text,
  pinned           boolean,
  pin_error        text,
  last_error       text,
  publish_at       timestamptz,
  last_checked_at  timestamptz,
  posted_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists video_first_comments_video_idx on public.video_first_comments (user_id, youtube_video_id);
create index if not exists video_first_comments_waiting_idx on public.video_first_comments (state, last_checked_at) where state = 'waiting';
alter table public.video_first_comments enable row level security;
drop policy if exists "video_first_comments_own_read" on public.video_first_comments;
create policy "video_first_comments_own_read" on public.video_first_comments
  for select to authenticated using (user_id = auth.uid());
