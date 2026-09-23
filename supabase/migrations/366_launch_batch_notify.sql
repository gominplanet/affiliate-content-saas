-- 366 — Launch Batch gets the notify-subscribers toggle, off by default.
--
-- WHAT WAS WRONG. Every video a batch uploaded rang the subscriber bell, and
-- there was no way to stop it. The scheduling call passed
-- `notifySubscribers: true` in plain code, and the upload call passed nothing,
-- which YouTube treats as true. Everywhere else in MVP the creator has a
-- toggle; here they had a fixed "yes" they could not see.
--
--   true   subscribers are notified when each video goes public
--   false  they are not (the default, and what an old batch reads as)
--
-- The uploader reads this for every video and sends YouTube the exact value
-- on the upload and on the scheduling call. Before this column exists the
-- uploader treats every batch as false.
--
-- Safe to run more than once.

alter table public.launch_batches
  add column if not exists notify_subscribers boolean not null default false;

comment on column public.launch_batches.notify_subscribers is
  'The creator''s toggle: notify subscribers when each video in this batch goes public. Off by default. Sent to YouTube explicitly on the upload and the scheduling call, because YouTube''s own default is to notify.';
