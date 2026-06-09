-- © 2026 Gominplanet / MVP Affiliate
--
-- Per-user Geniuslink-group cache for the YouTube Co-Pilot path.
--
-- The YT-description flow is traffic-source-agnostic about WHICH blog site
-- the user runs (the link goes in the video's YouTube description, not on
-- a blog), so we route it to a single per-user group named "MVP-YOUTUBE".
-- This sits side-by-side with the per-site group resolved by migration
-- 112 (wordpress_sites.geniuslink_group_id) — together they let the user
-- tell at a glance whether a click came from a YouTube description or
-- from an MVP-generated blog post.
--
-- Resolution flow (lib/geniuslink-group.ts → resolveGeniuslinkYouTubeGroupId):
--   1. integrations.geniuslink_youtube_group_id NOT NULL → use it.
--   2. NULL → list groups, match "MVP-YOUTUBE" by name.
--   3. Not found → auto-create the group via the Geniuslink API.
--   4. Persist whatever we resolved back to integrations.
--
-- NULL = unresolved; users can clear it to force re-resolution after
-- deleting the group on Geniuslink's side.

alter table public.integrations
  add column if not exists geniuslink_youtube_group_id integer;

comment on column public.integrations.geniuslink_youtube_group_id is
  'Geniuslink group ID for the per-user "MVP-YOUTUBE" bucket. All YouTube Co-Pilot (description) generations route here so clicks from YT-side traffic stay separate from blog-side traffic (the latter routes to wordpress_sites.geniuslink_group_id). Resolved lazily; cached here.';
