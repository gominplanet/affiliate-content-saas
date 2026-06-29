-- 147_youtube_calendar_cache.sql
--
-- Per-(user, channel) cache for the Co-Pilot planning calendar.
--
-- The calendar must scan the creator's ENTIRE uploads library (they schedule
-- videos up to ~3 months out, scattered across hundreds of unpublished
-- back-catalog uploads), so a cold scan walks every page of the uploads
-- playlist — slow + quota-heavy. Re-doing that on every page load would be
-- unacceptable, so we cache the computed events here. Subsequent loads serve
-- from this row instantly; "Refresh from YouTube" (?refresh=1) forces a fresh
-- full scan and rewrites the row.
--
-- `events` is the minimal calendar payload: [{ youtubeVideoId, title, status,
-- publishAt, publishedAt }]. `truncated` flags that the catalog was larger than
-- the scan cap. One row per (user, channel) — channel_id '' = the default chan.

create table if not exists public.youtube_calendar_cache (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  channel_id  text        not null default '',
  events      jsonb       not null default '[]'::jsonb,
  truncated   boolean     not null default false,
  cached_at   timestamptz not null default now(),
  primary key (user_id, channel_id)
);

alter table public.youtube_calendar_cache enable row level security;

-- Users read / write only their own rows.
create policy "youtube_calendar_cache: user read own"
  on public.youtube_calendar_cache for select
  using (auth.uid() = user_id);

create policy "youtube_calendar_cache: user write own"
  on public.youtube_calendar_cache for all
  using (auth.uid() = user_id);
