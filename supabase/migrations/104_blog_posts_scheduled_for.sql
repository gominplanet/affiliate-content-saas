-- Migration 104: blog_posts.scheduled_for + blog_posts.schedule_mode
--
-- Adds the columns the Library uses to render the "Scheduled · Jun 6 at
-- 10:20 AM" badge on a row whose post hasn't gone live yet. Until now
-- the post-scheduling flow stored everything in scheduled_posts —
-- great for the cron worker, useless for the Library row which doesn't
-- query scheduled_posts on initial load.
--
-- Both columns are nullable + only populated when the post was queued
-- via /api/blog/schedule-publish. A live (immediate-publish) post
-- leaves them null forever, so the Library treats absence as "live".
--
-- We DON'T flip them back to null after the schedule fires — keeping
-- them is useful audit history (and the Library renders "live" once
-- scheduled_for is in the past, so a stale row doesn't show a stuck
-- "Scheduled" pill).

alter table public.blog_posts
  add column if not exists scheduled_for timestamptz;

alter table public.blog_posts
  add column if not exists schedule_mode text
    check (schedule_mode is null or schedule_mode in ('wp-native', 'draft-flip'));

-- Index for the Library's per-user "show scheduled posts" filter +
-- any future "what posts are due in the next 24h" admin queries.
-- Partial — only future-scheduled rows; live posts are excluded.
create index if not exists blog_posts_scheduled_for_idx
  on public.blog_posts (user_id, scheduled_for)
  where scheduled_for is not null;
