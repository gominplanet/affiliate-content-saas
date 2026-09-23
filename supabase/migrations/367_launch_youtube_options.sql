-- 367 — Launch Batch gets its YouTube options: a playlist, and SCOUT's Studio
-- steps, with what actually happened recorded per video.
--
-- WHAT WAS MISSING. Co-Pilot let a creator pick a playlist and send SCOUT into
-- YouTube Studio for the settings the API cannot touch (paid promotion, AI
-- use, monetization, the ad rating, the product tag, the end screen). A batch
-- of ten had none of it, so every batch video was finished by hand, ten times.
--
--   launch_batches.playlist_id     the playlist each video is added to after
--                                  upload. Null means none.
--   launch_batches.studio_options  which Studio steps SCOUT does when the
--                                  creator presses Finish in Studio. {} reads
--                                  as the creator's full set of steps.
--   launch_items.playlist_added_at when YouTube confirmed the video is in the
--                                  playlist.
--   launch_items.playlist_error    what YouTube said when it was not, so a
--                                  video missing from its playlist does not
--                                  look like one that is in it.
--   launch_items.studio_finish     SCOUT's last run on this video, step by step,
--                                  as Studio read back. Null means never run.
--
-- Before this runs, the page and the uploader treat every batch as "no
-- playlist" and do not save Studio results, and the page says why.
--
-- Safe to run more than once.

alter table public.launch_batches
  add column if not exists playlist_id text,
  add column if not exists studio_options jsonb not null default '{}'::jsonb;

alter table public.launch_items
  add column if not exists playlist_added_at timestamptz,
  add column if not exists playlist_error text,
  add column if not exists studio_finish jsonb;

comment on column public.launch_batches.playlist_id is
  'The YouTube playlist each video in this batch is added to once uploaded. Null means none.';

comment on column public.launch_batches.studio_options is
  'Which YouTube Studio steps SCOUT does when the creator presses Finish in Studio: disclosures, monetize, adRating, tagProduct, endScreen (booleans). A missing key means on.';

comment on column public.launch_items.playlist_added_at is
  'When YouTube confirmed this video was added to the batch playlist.';

comment on column public.launch_items.playlist_error is
  'What YouTube said when the video could not be added to the batch playlist.';

comment on column public.launch_items.studio_finish is
  'SCOUT''s last Studio run on this video: each step, whether it read back as done, and its own words. Null means SCOUT has not been run on it.';
