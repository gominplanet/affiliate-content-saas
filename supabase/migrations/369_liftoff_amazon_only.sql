-- 369 — Liftoff can skip YouTube and go to Amazon only.
--
-- WHY. Video Launchpad is retired into Liftoff (the batch launcher), and the
-- one thing Launchpad did that Liftoff did not was let a creator skip YouTube
-- and send a video to their Amazon storefronts alone. Without it, retiring
-- Launchpad would have taken that away.
--
--   send_to_youtube = true    YouTube and Amazon, as before (the default,
--                             and what every existing batch reads as)
--   send_to_youtube = false   Amazon only: nothing is uploaded to YouTube;
--                             each video is handed straight to the Amazon
--                             side once it is prepared and Liftoff is pressed
--
-- Before this runs, every batch goes to YouTube, exactly as today, and the
-- page says the Amazon-only choice needs this update.
--
-- Safe to run more than once.

alter table public.launch_batches
  add column if not exists send_to_youtube boolean not null default true;

comment on column public.launch_batches.send_to_youtube is
  'False: Amazon only. Nothing goes to YouTube; each video is handed to the Amazon side once launched. True (default): YouTube and Amazon.';
