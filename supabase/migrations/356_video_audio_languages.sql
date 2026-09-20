-- 356 — remember which languages a video already carries.
--
-- Checking for an existing YouTube dub is a POST to the ingest service that
-- runs yt-dlp, with a sixty second ceiling, and it was being made once per
-- MARKET. Dubbing one video for Spain and Italy asked the same question about
-- the same video twice; five European markets asked it five times. It is also
-- the flakiest dependency in the product, because it is the one that meets
-- YouTube's bot wall and needs live cookies.
--
-- And for most creators the answer is no. A channel that has never used
-- YouTube's auto-dub paid that call in full before every single dub, to be told
-- nothing each time.
--
-- So the answer lives on the video. The catalogue drain already asks once per
-- video, which means the background grid fills this for the Launchpad path at
-- no extra cost.
--
-- EMPTY IS NOT NULL. An empty array means the video was read and carries only
-- its original audio. NULL means nobody has looked yet. A service outage must
-- never be recorded as "this video has no French track", which is a finding
-- about the video rather than about us, and the two columns together are what
-- keep those apart: a row with audio_languages_at set has a real answer.
--
-- Safe to run more than once.

alter table public.youtube_videos
  add column if not exists audio_languages    text[],
  add column if not exists audio_languages_at timestamptz;

comment on column public.youtube_videos.audio_languages is
  'Language codes this video already carries on YouTube, lowercased, from the ingest service. An EMPTY array means it was read and has only its original audio; NULL means nobody has looked. Those are opposite facts: collapsing them turns a service outage into a finding about the video. Re-read after a week, since a creator can add a track at any time.';

notify pgrst, 'reload schema';
