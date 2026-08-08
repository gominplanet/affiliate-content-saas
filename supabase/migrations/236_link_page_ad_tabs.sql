-- 236 — Link in Bio: multiple advertisement "tabs" + editable section headings.
--
-- Ads move from a single ad_* block on link_pages (mig 235) to repeatable
-- link_page_items with kind='ad' — each a clickable tab (icon/thumbnail + title +
-- optional discount badge + subtitle + optional promo code + arrow). badge/code
-- are the two fields items didn't already have.
--
-- Section headings become creator-editable (with sensible defaults in the
-- renderer): the Stories strip, the Ads strip, and the More-products strip.

ALTER TABLE link_page_items
  ADD COLUMN IF NOT EXISTS badge text,   -- e.g. "$20 Off"
  ADD COLUMN IF NOT EXISTS code  text;   -- e.g. "Cameron20"

ALTER TABLE link_pages
  ADD COLUMN IF NOT EXISTS heading_stories text,
  ADD COLUMN IF NOT EXISTS heading_ads     text,
  ADD COLUMN IF NOT EXISTS heading_more    text,
  -- Custom accent color (hex). Overrides the theme preset's accent when set —
  -- drives the CTA button, product "Shop now" buttons, ad code highlight, etc.
  ADD COLUMN IF NOT EXISTS accent          text;

NOTIFY pgrst, 'reload schema';
