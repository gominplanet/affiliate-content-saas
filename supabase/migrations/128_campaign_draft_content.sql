-- 128: Persist generated campaign content BEFORE WordPress publish.
--
-- Incident 2026-06-14: campaign generation spent the (expensive) Opus write,
-- then lost it when the run was interrupted or the WordPress publish failed —
-- "paid, got nothing." These columns let the route save the finished post the
-- instant it's written, so a publish failure leaves a recoverable draft that
-- can be RE-published with zero new AI spend.

alter table campaigns add column if not exists generated_title   text;
alter table campaigns add column if not exists generated_content text;
alter table campaigns add column if not exists generated_excerpt text;
alter table campaigns add column if not exists generated_slug    text;
