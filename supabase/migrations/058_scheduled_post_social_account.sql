-- 058 — scheduled_posts.social_account_id: target a chosen account on schedule
--
-- When a Pro user schedules a Facebook post and has picked a specific Page in
-- the per-post dropdown, we persist WHICH destination the cron worker should
-- publish to. Nullable — when absent the worker falls back to the user's
-- default / legacy integrations credentials, exactly like before. ON DELETE
-- SET NULL so removing an account never orphans a scheduled row (it just
-- reverts to the default at fire time).

alter table public.scheduled_posts
  add column if not exists social_account_id uuid
    references public.social_accounts(id) on delete set null;
