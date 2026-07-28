-- 193 — User-configurable header & footer background colors for the blog theme.
--
-- Empty/NULL means "use the theme default" (translucent-white glass header,
-- soft-charcoal footer). When set, the theme paints that background and
-- auto-computes a readable text color from its luminance.
ALTER TABLE brand_profiles
  ADD COLUMN IF NOT EXISTS header_bg_color text,
  ADD COLUMN IF NOT EXISTS footer_bg_color text;

NOTIFY pgrst, 'reload schema';
