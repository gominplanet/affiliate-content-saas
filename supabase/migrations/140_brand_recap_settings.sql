-- 140_brand_recap_settings.sql
--
-- "Share with brand" feature: store the creator's customizable recap-message
-- template on their brand profile. One jsonb column keeps it flexible
-- (template body + tone + sign-off name/site). NULL = use the in-code default
-- (lib/brand-recap.ts DEFAULT_RECAP_TEMPLATE), so nothing breaks for existing
-- rows and the feature works before a user ever opens the settings modal.

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS brand_recap_settings jsonb;

COMMENT ON COLUMN public.brand_profiles.brand_recap_settings IS
  'Customizable "Share with brand" recap message: { template, tone, senderName, siteUrl }. NULL = use the in-code default.';
