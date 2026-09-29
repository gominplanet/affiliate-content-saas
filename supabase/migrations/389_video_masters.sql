-- 389: the original file behind a video MVP uploaded, kept.
--
-- Clip Factory cuts clips from a video's file. For a video MVP made (Co-Pilot
-- or Liftoff) MVP had that file, but the Clip Factory clean-up deleted it after
-- 24 hours, so clips had to be downloaded back from YouTube, which YouTube
-- blocks. This records the original per YouTube video; the clean-up leaves
-- these files alone and Clip Factory renders from them.
--
-- The insert below fills it for Liftoff videos already published, where the
-- original is still on file. Safe to run more than once.
create table if not exists public.video_masters (
  user_id          uuid not null references auth.users(id) on delete cascade,
  youtube_video_id text not null,
  file_url         text not null,
  source           text,
  created_at       timestamptz not null default now(),
  primary key (user_id, youtube_video_id)
);
alter table public.video_masters enable row level security;
drop policy if exists "own video masters" on public.video_masters;
create policy "own video masters" on public.video_masters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into public.video_masters (user_id, youtube_video_id, file_url, source)
select li.user_id, yv.youtube_video_id, li.clean_url, 'liftoff'
from public.launch_items li
join public.youtube_videos yv on yv.id = li.video_id
where li.clean_url is not null and length(yv.youtube_video_id) = 11
on conflict (user_id, youtube_video_id) do nothing;

notify pgrst, 'reload schema';
