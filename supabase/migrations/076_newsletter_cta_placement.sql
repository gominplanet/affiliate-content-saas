-- 076 — Creator-controlled placement for the newsletter signup form
--
-- Until now the form was hard-coded to render in one spot per surface:
--   homepage → directly under the 3-up ad strip
--   sidebar  → between the WP widgets and the MVP ad blocks
--
-- Creators asked to pick where it sits. Two text columns, each enforced
-- to a small set of slot names by the dashboard UI (server validates
-- against the same list).
--
-- Slot semantics:
--   homepage_placement
--     'before_pick'  → above the Pick of the Day section
--     'after_pick'   → below Pick of the Day, before the ad strip
--     'after_ads'    → below the ad strip (the current default)
--     'footer'       → in the footer area, above the legal line
--
--   sidebar_placement
--     'top'          → first element in every blog-post sidebar
--     'bottom'       → after WP widgets AND the MVP ad blocks (last)
--
-- NULL on either column = use the theme's default ('after_ads' / 'bottom').

alter table public.newsletter_settings
  add column if not exists homepage_placement text,
  add column if not exists sidebar_placement text;
