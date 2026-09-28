-- 384: keeping review posts current with the creator's own update
-- (lib/post-refresh.ts, /api/blog/refresh).
--
-- refreshed_at           when the creator last added an update line to the post
-- refresh_note           that line, as it went into the post
-- refresh_snoozed_until  "nothing new yet": not asked again before this time
--
-- Safe to run more than once.
alter table public.blog_posts add column if not exists refreshed_at timestamptz;
alter table public.blog_posts add column if not exists refresh_note text;
alter table public.blog_posts add column if not exists refresh_snoozed_until timestamptz;
