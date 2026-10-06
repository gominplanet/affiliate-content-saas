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
--
-- AND ONLY PRO MEMBERS FROM BEFORE THE CHANGE. The first version marked every
-- Pro account with no mark, so running it again (or for the first time) after
-- 2026-10-06 would hand the old, higher limits for good to members who joined
-- Pro after they were lowered. A member from before the change is one whose
-- current billing window began before 2026-10-06 (an annual member's began
-- earlier still). Run after about 2026-11-06, when every monthly window has
-- rolled over, it marks nobody new, which is the safe way to be wrong: a mark
-- already made is never removed. An account with no billing window on record
-- (a comped Pro) counts from when the account was created.

alter table public.integrations add column if not exists limits_cohort text;

update public.integrations
   set limits_cohort = 'pro-before-2026-10-06'
 where tier = 'pro'
   and limits_cohort is null
   and coalesce(subscription_period_start, created_at) < '2026-10-06T00:00:00Z'::timestamptz;
