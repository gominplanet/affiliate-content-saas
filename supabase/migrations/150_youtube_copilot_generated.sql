-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 150 — youtube_copilot_generated: track "metadata was GENERATED for
-- this video in Co-Pilot" (distinct from youtube_copilot_pushes = "APPLIED to
-- YouTube via MVP", mig 109).
--
-- WHY: the Co-Pilot tab rule only moved a video out of "Needs metadata" when we
-- pushed metadata via /api/youtube/apply (metadataAppliedAt) or when MVP's synced
-- copy already showed a real description. A creator who generates metadata in
-- Co-Pilot and then finishes the video in YouTube Studio DIRECTLY (never clicking
-- MVP's Apply) left no signal, so the video was stuck in "Needs metadata" —
-- and, being scheduled, jumped straight to "Live on YouTube" on publish, never
-- passing through "Metadata sent". Recording the generate lets the video move to
-- "Metadata sent" the moment it's handled in Co-Pilot, however it's finished.
--
-- Mirrors mig 109 exactly (lightweight event log, no dependency on a full
-- youtube_videos row — Co-Pilot users who never /api/youtube/sync still get a row).

create table if not exists public.youtube_copilot_generated (
  user_id uuid not null references auth.users(id) on delete cascade,
  youtube_video_id text not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, youtube_video_id)
);

create index if not exists youtube_copilot_generated_user_idx
  on public.youtube_copilot_generated (user_id, generated_at desc);

alter table public.youtube_copilot_generated enable row level security;

drop policy if exists "Users manage own copilot generated" on public.youtube_copilot_generated;
create policy "Users manage own copilot generated"
  on public.youtube_copilot_generated
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
