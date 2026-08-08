-- 235 — Link in Bio: a custom main CTA button + an optional advertisement slot.
--
-- cta_*  : one prominent button rendered right under the header (logo + tagline),
--          e.g. "Shop My Amazon Storefront" → any URL, with a creator-set label.
-- ad_*   : an optional sponsor/advertisement insert the creator can toggle on and
--          fill (image + title + subtitle + link). Off by default.

ALTER TABLE link_pages
  ADD COLUMN IF NOT EXISTS cta_label     text,
  ADD COLUMN IF NOT EXISTS cta_url       text,
  ADD COLUMN IF NOT EXISTS ad_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ad_image_url  text,
  ADD COLUMN IF NOT EXISTS ad_title      text,
  ADD COLUMN IF NOT EXISTS ad_subtitle   text,
  ADD COLUMN IF NOT EXISTS ad_url        text;

NOTIFY pgrst, 'reload schema';
