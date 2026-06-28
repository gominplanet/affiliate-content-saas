-- 144_wordpress_content_only_mode.sql
--
-- "Bring your own theme" / content-only mode (2026-06-27).
--
-- Some creators already have a WordPress blog with a theme + plugins they like
-- and only want MVP as an article generator — they do NOT want MVP's theme,
-- plugin, Editor's Picks curation, topic hubs, or self-update prompts. For
-- those sites MVP should publish a clean, self-contained post that inherits
-- the site's own theme, and leave everything else alone.
--
-- Two per-SITE settings (a user can run one site in full-MVP mode and another
-- content-only):
--   content_only  — true → suppress all MVP theme/plugin surfaces for this site
--                   and publish via the standard WP REST path (App Password),
--                   never assuming the MVP plugin is present.
--   cta_style     — how the in-article affiliate CTA renders:
--                   'button' (MVP's styled price-strip button, the default) or
--                   'link'   (a plain themed text link, so it matches the
--                            creator's own theme instead of MVP's button CSS).
--
-- Defaults keep every existing site behaving exactly as before: content_only
-- = false (full MVP treatment), cta_style = 'button' (MVP styled button).

ALTER TABLE public.wordpress_sites
  ADD COLUMN IF NOT EXISTS content_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cta_style text NOT NULL DEFAULT 'button';

-- Guard the cta_style enum at the DB so a bad value can never reach the
-- renderer. Drop-then-add keeps the migration idempotent on re-run.
ALTER TABLE public.wordpress_sites
  DROP CONSTRAINT IF EXISTS wordpress_sites_cta_style_chk;
ALTER TABLE public.wordpress_sites
  ADD CONSTRAINT wordpress_sites_cta_style_chk
  CHECK (cta_style IN ('button', 'link'));

COMMENT ON COLUMN public.wordpress_sites.content_only IS
  'true = bring-your-own-theme: MVP only generates articles, suppresses MVP theme/plugin/curation surfaces and publishes via standard WP REST.';
COMMENT ON COLUMN public.wordpress_sites.cta_style IS
  'In-article affiliate CTA style: button (MVP styled price-strip, default) or link (plain themed text link).';

-- Mirror the same two flags onto the legacy single-site `integrations` row.
-- Most NEW users connect through the legacy path (connect-token / app-password
-- writes integrations.wordpress_*, not wordpress_sites), and getDefaultSite's
-- legacy bridge reads from here. Without these columns a single-site
-- content-only onboarder's choice would be lost (the bridge would hardcode
-- content_only=false). Same defaults → no behaviour change for existing rows.
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS content_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cta_style text NOT NULL DEFAULT 'button';

ALTER TABLE public.integrations
  DROP CONSTRAINT IF EXISTS integrations_cta_style_chk;
ALTER TABLE public.integrations
  ADD CONSTRAINT integrations_cta_style_chk
  CHECK (cta_style IN ('button', 'link'));

COMMENT ON COLUMN public.integrations.content_only IS
  'Legacy single-site mirror of wordpress_sites.content_only — bring-your-own-theme mode for users on the legacy integrations.wordpress_* path.';
COMMENT ON COLUMN public.integrations.cta_style IS
  'Legacy single-site mirror of wordpress_sites.cta_style (button | link).';
