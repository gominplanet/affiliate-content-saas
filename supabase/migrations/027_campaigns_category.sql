-- Migration 027: campaigns.category
--
-- Records the category chosen for a campaign post. NULL means "not
-- confidently resolved" — the CC Campaigns page then shows a dropdown
-- so the user can pick one of their real categories themselves
-- (instead of the post silently landing in WordPress's default "Blog"
-- category, which is never what's wanted).
--
-- Idempotent.

alter table public.campaigns
  add column if not exists category text;
