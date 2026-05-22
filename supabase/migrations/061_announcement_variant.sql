-- 061 — announcements.variant: pick the banner's look from the admin editor
--
-- Folds the old hardcoded "What's New" feature banner into the admin-managed
-- announcement system. 'news' = red alert look (Megaphone). 'feature' = the
-- colorful orange→magenta gradient with a "NEW" badge (Sparkles). Defaults to
-- 'news'. Depends on migration 060.

alter table public.announcements
  add column if not exists variant text not null default 'news';
