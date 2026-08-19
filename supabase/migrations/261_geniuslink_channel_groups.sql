-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 261 — per-social-channel Geniuslink group attribution.
--
-- Blog links already route to a per-domain group and YouTube to MVP-YOUTUBE, so
-- a creator can tell blog clicks from YouTube clicks. This extends the same idea
-- to every social channel: when a post is shared to Facebook / Pinterest / X /
-- etc., its link is minted into that channel's own group (MVP-FACEBOOK, …), so
-- the Geniuslink dashboard shows clicks per source.
--
-- Two caches, both jsonb maps, both best-effort (a miss just re-resolves):
--   integrations.geniuslink_channel_groups  = { "<channel>": <groupId> }
--   blog_posts.geniuslink_channel_urls       = { "<channel>": "<geni.us url>" }
-- The per-channel short URLs are per-post (same destination, one short code per
-- channel so each carries its channel's group).

alter table public.integrations
  add column if not exists geniuslink_channel_groups jsonb;

alter table public.blog_posts
  add column if not exists geniuslink_channel_urls jsonb;
