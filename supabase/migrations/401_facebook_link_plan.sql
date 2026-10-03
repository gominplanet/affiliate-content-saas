-- Facebook setup, following Meta's own help page (facebook.com/help/1929252614431792):
-- the link allowance resets on the 1st of each month, or, with a Meta One
-- plan, on the day the plan renews. This keeps that day.
--
-- integrations.facebook_link_limit now holds the creator's Meta One plan:
-- 'free', 'essential', 'advanced', 'expert', 'max', or 'not_limited'.
-- (The first answers, 'limited', 'unsure' and 'unlimited', are still read.)
--
-- Safe to run twice.

alter table public.integrations add column if not exists facebook_link_renews_day integer;
