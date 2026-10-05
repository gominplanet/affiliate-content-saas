-- 405: Current Pro members keep their limits for good.
--
-- On 2026-10-05 the Pro limits were lowered for NEW members (generations 100
-- to 60, thumbnails 300 to 200, Pinterest 200 to 145, Instagram 200 to 145,
-- Facebook 150 to 110, X 100 to 75, collab emails 100 to 30). Seb: everyone
-- already on Pro keeps the limits they had, permanently. This marks who they are: every account on
-- Pro when this runs. lib/tier effectiveCap reads the mark.
--
-- Safe to run twice: the column is only added once, and only unmarked Pro
-- accounts are marked.

alter table public.integrations add column if not exists limits_cohort text;

update public.integrations
   set limits_cohort = 'pro-before-2026-10-06'
 where tier = 'pro'
   and limits_cohort is null;
