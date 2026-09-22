-- 360 — did the thumbnail we designed actually reach YouTube?
--
-- WHAT WAS WRONG. The batch worker designed a thumbnail for every video, stored
-- both versions of it, handed the clean one to Amazon, and then uploaded the
-- video to YouTube without ever setting it. YouTube picked its own frame. The
-- service has had an uploadThumbnail method the whole time; the launch worker
-- was the one caller that never used it.
--
-- Nothing on screen could tell you. The row showed the designed image, because
-- the row reads the image we stored, not the one on the channel. A creator's
-- first words about it were "no idea what the thumbnail looks like or if it was
-- even made", and both halves of that were fair: it was made, and it was not
-- used.
--
-- TWO COLUMNS, BECAUSE THERE ARE THREE OUTCOMES. Set, refused, and not tried
-- yet. One nullable timestamp collapses the last two into the same blank, which
-- is the shape of silence this codebase keeps producing.
--
-- Safe to run more than once.

alter table public.launch_items
  add column if not exists thumbnail_set_at timestamptz,
  add column if not exists thumbnail_error text;

comment on column public.launch_items.thumbnail_set_at is
  'When the designed thumbnail was accepted by YouTube for this video. Null with a null thumbnail_error means it has not been attempted yet, which is not the same as having failed.';

comment on column public.launch_items.thumbnail_error is
  'What YouTube said when it refused the thumbnail. The video is on the channel either way, so this never blocks the row; it exists so a video running YouTube''s own chosen frame is distinguishable on screen from one running the thumbnail we designed.';
