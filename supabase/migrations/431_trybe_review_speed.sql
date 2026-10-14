-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- 431: HOW FAST A BRAND DECIDES VIDEOS (Huntr's "review speed", Seb
-- 2026-10-14). Each member's own figures per brand, read by SCOUT from their
-- TRYBE submissions in My brands: the middle number of days from sending a
-- video to approved or rejected (review_days), how many videos that is from
-- (review_n), and of the videos sent 7 to 60 days ago, how many still wait
-- (slow of recent). Shown only combined (5 members at least, lib/trybe-changes
-- poolBrands), like the rest of this table. Deleted with the member's rows when
-- they turn off "Include my results".
--
-- Safe to run twice.

alter table public.trybe_member_stats add column if not exists review_days numeric;
alter table public.trybe_member_stats add column if not exists review_n integer;
alter table public.trybe_member_stats add column if not exists slow integer;
alter table public.trybe_member_stats add column if not exists recent integer;

notify pgrst, 'reload schema';
