-- 471: brand challenges (Seb, 2026-11-20: "build the challenge tracker"). A
-- brand offers a bonus for a number of approved videos by a date, such as
-- NOBL's 300 approved by November 30 for $10,000. Each member keeps up to 12:
-- the brand, the target, the start and end days and the reward
-- (lib/trybe-challenge readChallenges). The submissions themselves are read
-- through SCOUT on the page and never stored.
--
-- Written and read by the server only (no policies).
--
-- Safe to run twice.

alter table public.trybe_outreach_settings add column if not exists challenges jsonb;

notify pgrst, 'reload schema';
