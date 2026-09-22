-- 361 — where a launch video's title actually came from.
--
-- WHAT WAS WRONG. Adding videos to a batch seeded each title from the uploaded
-- FILE NAME, and nothing ever replaced it. So a creator uploaded a file called
-- "STEAM BRUSH WORKS?.mp4" and that string became the video's title, the
-- subject handed to the thumbnail generator, the subject handed to the
-- description writer, and the title on YouTube. On the same channel, videos
-- that went through Video Launchpad read "Finally, a Camping Table That
-- Actually Fits in the Boot". The batch had a Write it for me button, one press
-- per video, and a creator who never pressed it got ten file names.
--
-- WHY A COLUMN AND NOT A GUESS. "STEAM BRUSH WORKS?" does not look like a file
-- name, so no amount of pattern matching separates it from a title somebody
-- meant. What separates them is where it came from, and only the thing that
-- wrote it knows that. Guessing would have silently overwritten titles people
-- typed, which is a worse failure than the one being fixed.
--
--   filename  the upload named it, nobody chose it
--   creator   typed or picked by the creator, never overwritten
--   mvp       written from the product by MVP, written once
--
-- Safe to run more than once.

alter table public.launch_items
  add column if not exists title_source text;

comment on column public.launch_items.title_source is
  'Where this title came from: filename (seeded from the uploaded file, nobody chose it), creator (typed or picked, never overwritten by the worker), or mvp (written from the product). Null on rows that predate this column and is treated as filename, because those rows are the ones that carried file names to YouTube.';
