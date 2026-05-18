-- Migration 032: collaboration questionnaire additions
--
-- - product_or_asin: the specific product/ASIN the creator wants to
--   pitch (centered in the email when present)
-- - example_links: up to 3 links to past work the creator is proud of
--   (we offer examples, never stats — platform ToS)
-- - portfolio_url: a single link hub (e.g. Linktree) of all channels
--
-- Requires migration 030 (collaborations table). Idempotent.

alter table public.collaborations
  add column if not exists product_or_asin text,
  add column if not exists example_links   text[] not null default '{}',
  add column if not exists portfolio_url    text;
