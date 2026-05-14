-- Migration 013: Add Bluesky integration columns
--
-- Bluesky uses AT Protocol with App Passwords (user-generated in their
-- Bluesky settings) rather than OAuth. We store the handle (e.g.
-- 'mvpaffiliate.bsky.social'), the app password, and the resolved DID
-- (decentralized identifier) so we can create posts on the user's behalf.

alter table public.integrations
  add column if not exists bluesky_handle       text,
  add column if not exists bluesky_app_password text,
  add column if not exists bluesky_did          text;

alter table public.blog_posts
  add column if not exists bluesky_post_uri text;
