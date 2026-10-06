-- Migration 396: Liftoff sends big videos to YouTube in pieces across runs.
--
-- A run has about five minutes, and a 288MB video could not reach YouTube in
-- one: all three tries stopped before they could report back. The upload now
-- opens a YouTube resumable session once, keeps its address here, and sends
-- the file in 32MB pieces over as many runs as it takes, each run carrying on
-- where the last stopped. Cleared when the video is on YouTube.
--
-- Without this column big videos upload the old way (one request per run).
-- Safe to run twice.

alter table public.launch_items add column if not exists yt_upload_url text;

notify pgrst, 'reload schema';
