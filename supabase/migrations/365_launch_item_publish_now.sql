-- 365 — a video only goes public immediately if the creator agreed to it.
--
-- WHAT HAPPENED. A creator set a launch video for today at 17:00 and pressed
-- Launch. The uploader got to it at 18:09. It decided "public now" by
-- comparing the planned time to the clock AT UPLOAD TIME: 17:00 had gone, so
-- up it went, public, on a real channel. The creator had never been told that
-- would happen, because at the moment they pressed Launch 17:00 was still in
-- the future and the page had nothing to warn about.
--
-- "Now" is only a choice somebody made if it was true WHEN THEY CHOSE. So the
-- launch route records it here, for exactly the videos whose time had already
-- gone as Launch was pressed (the ones the page warned about, in amber, before
-- the button). The uploader reads this instead of the clock:
--
--   publish_now = true   the creator saw "goes public as soon as it uploads"
--                        and pressed Launch. Uploaded public.
--   publish_now = false  a time that passes while the video is still queued is
--                        a slot we missed, not a decision. Uploaded PRIVATE,
--                        and the row asks for a new time.
--
-- Safe to run more than once.

alter table public.launch_items
  add column if not exists publish_now boolean not null default false;

comment on column public.launch_items.publish_now is
  'True only when this video''s time had already passed at the moment the creator pressed Launch, having been told it would go public as soon as it uploaded. The uploader never decides "public now" from the clock alone: a time that passes while a video is still queued keeps it private and asks for a new time.';
