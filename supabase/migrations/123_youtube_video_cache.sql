-- 123_youtube_video_cache.sql
--
-- Per-user cache of the YouTube uploads playlist scan.
-- Eliminates repeated channels.list + playlistItems.list + videos.list calls
-- on every Co-Pilot page load.  The route writes here after each scan and
-- reads it back on subsequent loads — bypassing the YouTube API entirely until
-- the TTL expires (15 min) or the user explicitly hits Refresh.
--
-- One row per user; primary key = user_id (upsert pattern).
-- `uploads_playlist_id` is stored so we skip channels.list on the next scan.
-- `videos` is the full enriched DraftVideo[] array — drafts AND published,
-- so search can filter in-memory without ever calling search.list (100 units).
-- `full_scan` is true when we exhausted the entire uploads playlist.

create table if not exists public.youtube_video_cache (
  user_id              uuid        primary key references auth.users(id) on delete cascade,
  uploads_playlist_id  text        not null,
  videos               jsonb       not null default '[]'::jsonb,
  video_count          int         not null default 0,
  cached_at            timestamptz not null default now(),
  full_scan            boolean     not null default false
);

alter table public.youtube_video_cache enable row level security;

-- Users read / write only their own row
create policy "youtube_video_cache: user read own"
  on public.youtube_video_cache for select
  using (auth.uid() = user_id);

create policy "youtube_video_cache: user write own"
  on public.youtube_video_cache for all
  using (auth.uid() = user_id);

-- Index for the common query pattern (though PK already covers it)
create index if not exists youtube_video_cache_user_id_idx
  on public.youtube_video_cache (user_id);
