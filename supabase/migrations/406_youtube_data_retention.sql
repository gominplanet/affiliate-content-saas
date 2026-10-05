-- 406: YouTube data retention (YouTube API Developer Policies III.E.4).
-- Records when each stored video's YouTube fields were last refreshed from
-- YouTube, so the daily retention job can refresh (or empty) anything older
-- than 30 days. Starts from updated_at for existing rows. Safe to run twice.
alter table public.youtube_videos add column if not exists yt_refreshed_at timestamptz;
update public.youtube_videos set yt_refreshed_at = updated_at where yt_refreshed_at is null;
create index if not exists idx_youtube_videos_yt_refreshed on public.youtube_videos (yt_refreshed_at);
