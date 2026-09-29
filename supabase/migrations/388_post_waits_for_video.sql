-- 388: a post held as a draft until its video is public.
--
-- MVP writes posts only from videos the public can watch. A post that went
-- live before its video did (scheduled or private on YouTube) is switched to
-- a WordPress draft by /api/cron/video-hold and published again, dated that
-- day, once the video is live. These two columns are how MVP knows which
-- drafts are its own to publish again, and when the video is due.
--
-- Safe to run more than once.
alter table public.blog_posts add column if not exists waiting_for_video_since timestamptz;
alter table public.blog_posts add column if not exists waiting_for_video_until timestamptz;
create index if not exists blog_posts_waiting_for_video_idx
  on public.blog_posts (waiting_for_video_since) where waiting_for_video_since is not null;
notify pgrst, 'reload schema';
