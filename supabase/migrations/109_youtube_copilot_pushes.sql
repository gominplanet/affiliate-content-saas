-- © 2026 Gominplanet / MVP Affiliate
--
-- Dedicated tracking table for "this video was successfully pushed back to
-- YouTube via MVP Co-Pilot". The previous attempt (migration 108) added a
-- column to public.youtube_videos, but that table has 4 NOT NULL columns
-- (channel_id, channel_title, title, published_at) that aren't populated
-- until /api/youtube/sync runs. For Co-Pilot users who never sync, the
-- upsert from the apply route would silently fail the INSERT branch and
-- the "Pushed via Co-Pilot" tab would always show 0.
--
-- This table has only the fields we genuinely need — a real timestamp that
-- can be written without first having a full video row. The drafts API
-- joins against it the same way it joined against youtube_videos.
--
-- Mirrors the lightweight "event log" pattern (tiktok_posts table, etc.).

create table if not exists public.youtube_copilot_pushes (
  user_id uuid not null references auth.users(id) on delete cascade,
  youtube_video_id text not null,
  pushed_at timestamptz not null default now(),
  primary key (user_id, youtube_video_id)
);

-- Reverse-chron index for the "shipped videos for this user" query the
-- drafts API runs on every page load.
create index if not exists youtube_copilot_pushes_user_pushed_idx
  on public.youtube_copilot_pushes (user_id, pushed_at desc);

-- RLS: each user reads/writes only their own rows. The apply/update routes
-- run server-side under the user's session, so the auth.uid() check is
-- the same pattern used elsewhere (blog_posts, youtube_videos).
alter table public.youtube_copilot_pushes enable row level security;

drop policy if exists "Users manage own copilot pushes" on public.youtube_copilot_pushes;
create policy "Users manage own copilot pushes"
  on public.youtube_copilot_pushes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
