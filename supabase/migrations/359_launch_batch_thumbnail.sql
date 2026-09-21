-- 359 — the thumbnail look a launch batch uses, chosen once like the CTA.
--
-- WHAT WAS WRONG. The batch worker built every thumbnail with no choice at all:
-- no style, no face, no badge, no look to match. Video Launchpad has had those
-- controls for months, so a batch was not a faster Launchpad, it was a
-- different and worse one, and the first creator to use it said so in four
-- words: "the thumbnail gets made, but with zero options".
--
-- SHARED ONCE, LIKE THE CTA. The look belongs to the batch, not to a video:
-- pick the hook style, the face, the pose and the look to match once, and every
-- video in the batch is made the same way. What stays per-video is what has to:
-- the product, the title, and the two images themselves.
--
-- thumbnail_chosen exists for the same reason cta_chosen does. An empty jsonb
-- cannot tell "they looked at the controls and kept the house look" apart from
-- "they have not been asked yet", and a batch that cannot tell those apart sits
-- waiting for an answer it already has.
--
-- Safe to run more than once.

alter table public.launch_batches
  add column if not exists thumbnail jsonb,
  add column if not exists thumbnail_chosen boolean not null default false;

comment on column public.launch_batches.thumbnail is
  'The thumbnail look for every video in this batch: hook style, face pick, pose, badge, accent, style reference. Validated by lib/thumbnail-preset.ts before it is stored, because a background worker replays it ten times with nobody watching. Null means the house look.';

comment on column public.launch_batches.thumbnail_chosen is
  'True once the creator has answered the thumbnail step, including by keeping the house look. Without it, "kept the default" and "never asked" are the same null.';

-- ── per video: how the thumbnail was actually made ─────────────────────────
--
-- REPORT WHAT HAPPENED, NOT WHAT WAS PLANNED. The batch generator can fall
-- back: the styled path fails and the plain product builder runs instead, and
-- the creator ends up with a thumbnail that is not the look they picked. Until
-- now those two outcomes wrote the same row and looked identical on screen, so
-- a look that never applied was indistinguishable from one that did.
alter table public.launch_items
  add column if not exists thumbnail_source text;

comment on column public.launch_items.thumbnail_source is
  'How this thumbnail was actually built: styled (the batch look was applied), plain (the styled path failed and the basic product builder ran), or null (no thumbnail). Read by the board so a fallback is visible rather than silent.';
