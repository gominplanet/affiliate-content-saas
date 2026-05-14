-- Migration 012: Add Twitter / X OAuth columns to integrations
--
-- Stores the OAuth 2.0 access + refresh tokens granted by the user when
-- they connect their X account, plus the @handle for display in the UI.
-- Also adds twitter_post_id to blog_posts for tracking which posts have
-- been tweeted.

alter table public.integrations
  add column if not exists twitter_access_token  text,
  add column if not exists twitter_refresh_token text,
  add column if not exists twitter_user_id       text,
  add column if not exists twitter_handle        text,
  add column if not exists twitter_expires_at    timestamptz;

alter table public.blog_posts
  add column if not exists twitter_post_id text;
