-- 434: hashtags on every platform (Seb, 2026-10-16).
--
-- 1. hashtag_trends: live hashtag readings from the platforms themselves,
--    shared by every member (lib/hashtag-trends). TikTok Creative Center's
--    trending list and Instagram's tag counts, read by SCOUT in a creator's
--    Chrome; YouTube's hashtag pages, read by cron/hashtag-trends. The engine
--    (lib/hashtag-engine) uses a trend only when it is about the content, and
--    never a tag the platform shows almost nobody using.
-- 2. reach_samples.note and post_url: every platform's posts are tracked now.
--    A platform that does not share results with MVP says why in note, so its
--    tags never read as tags that did nothing.
--
-- Safe to run twice.

create table if not exists public.hashtag_trends (
  platform text not null,
  tag text not null,
  source text not null,
  region text not null default 'US',
  rank integer,
  posts bigint,
  views bigint,
  label text,
  seen_at timestamptz not null default now(),
  first_seen_at timestamptz not null default now(),
  primary key (platform, tag, source, region)
);
create index if not exists hashtag_trends_recent_idx on public.hashtag_trends (platform, seen_at desc);
create index if not exists hashtag_trends_source_idx on public.hashtag_trends (source, seen_at desc);
-- Written and read by MVP's server only (service role).
alter table public.hashtag_trends enable row level security;

alter table public.reach_samples add column if not exists note text;
alter table public.reach_samples add column if not exists post_url text;
create index if not exists reach_samples_platform_idx on public.reach_samples (user_id, platform, posted_at desc);
