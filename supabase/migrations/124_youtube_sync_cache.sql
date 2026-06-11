-- 124_youtube_sync_cache.sql
--
-- Per-user cache for YouTube sync operations.
-- Prevents repeated API calls when users click "Sync videos" multiple times
-- within a 5-minute window. One row per user tracks the most recent sync's
-- page state and counts so fast re-clicks return cached results (0 units).

create table if not exists public.youtube_sync_cache (
  user_id              uuid        primary key references auth.users(id) on delete cascade,
  page_token           text,
  synced_count         int         not null default 0,
  next_page_token      text,
  cached_at            timestamptz not null default now()
);

alter table public.youtube_sync_cache enable row level security;

-- Users read / write only their own row
create policy "youtube_sync_cache: user read own"
  on public.youtube_sync_cache for select
  using (auth.uid() = user_id);

create policy "youtube_sync_cache: user write own"
  on public.youtube_sync_cache for all
  using (auth.uid() = user_id);

-- Index for the common query pattern (though PK already covers it)
create index if not exists youtube_sync_cache_user_id_idx
  on public.youtube_sync_cache (user_id);
