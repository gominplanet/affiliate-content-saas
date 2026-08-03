-- 210 — Per-platform social link mode (blog / affiliate / both).
--
-- User-set default that controls where a fanned-out post's link points, per
-- platform. Only Facebook / LinkedIn / Bluesky use it (the platforms with a
-- clickable caption link where the choice is meaningful). NULL / missing key =
-- 'blog', the existing behavior, so nothing changes until a user sets it.
--
-- Shape: { "facebook": "both", "linkedin": "blog", "bluesky": "affiliate" }.
-- Adding a jsonb column with no default is metadata-only (instant).
ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS social_link_modes jsonb;

NOTIFY pgrst, 'reload schema';
