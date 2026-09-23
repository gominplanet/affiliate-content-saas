-- 364 — each launch video can have its own YouTube date and time.
--
-- WHAT WAS WRONG. A batch had one schedule: a list of times of day and a first
-- day, and every video was laid out along it in order. Video 1 took the first
-- slot, video 2 the next, and nobody could say "this one on Friday at nine,
-- that one next Tuesday at six". The creator decides when their own videos go
-- out, video by video, and the page did not let them.
--
-- WHY TWO COLUMNS AND NOT A TIMESTAMP. What the creator picks is a wall-clock
-- date and time where they live, and that is what is stored. The instant
-- YouTube is given is worked out at launch against the batch's zone ON THAT
-- DATE, the same way the pattern already is, so a video set for 09:00 the week
-- after the clocks change still goes out at 09:00. A timestamptz captured
-- today would carry today's offset and go out an hour wrong.
--
--   both null   this video follows the batch pattern, as before
--   both set    this video goes out at exactly that date and time
--
-- One without the other is refused by the constraint below. Half an override
-- has no honest meaning: a date with no time would have to borrow one from a
-- pattern the creator stepped away from.
--
-- Nothing already scheduled moves. Existing rows get two nulls, which is the
-- pattern they were already on.
--
-- Safe to run more than once.

alter table public.launch_items
  add column if not exists custom_publish_date text,
  add column if not exists custom_publish_time text;

comment on column public.launch_items.custom_publish_date is
  'The creator''s own YouTube date for this one video, as YYYY-MM-DD in the batch''s timezone. Null means the video follows the batch pattern. Always set together with custom_publish_time.';

comment on column public.launch_items.custom_publish_time is
  'The creator''s own YouTube time for this one video, as HH:MM in the batch''s timezone. Null means the video follows the batch pattern. Always set together with custom_publish_date.';

alter table public.launch_items
  drop constraint if exists launch_items_custom_publish_pair;

alter table public.launch_items
  add constraint launch_items_custom_publish_pair check (
    (custom_publish_date is null and custom_publish_time is null)
    or (
      -- THE `is not null` IS NOT REDUNDANT. Without it, a date with no time
      -- makes the regex on the time evaluate to NULL rather than false, and a
      -- CHECK that evaluates to NULL PASSES. The first draft of this
      -- constraint accepted exactly the half-override it was written to
      -- refuse, and only running it against real rows showed it.
      custom_publish_date is not null
      and custom_publish_time is not null
      and custom_publish_date ~ '^\d{4}-\d{2}-\d{2}$'
      and custom_publish_time ~ '^([01]\d|2[0-3]):[0-5]\d$'
    )
  );
