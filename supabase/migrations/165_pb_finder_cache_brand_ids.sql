-- ── 165: brand identifiers on the PartnerBoost Finder cache ─────────────────
-- The Finder's "Message brand" deep-links to the brand's PartnerBoost page
-- (https://app.partnerboost.com/partner/brands/detail?id=<id>). The Finder
-- reads from pb_finder_cache, so the brand id has to live on each cached row.
-- Store BOTH ids PartnerBoost exposes (brand_id + mcid) so the link can use the
-- right one without a re-sync if the detail-page id turns out to be the mcid.
-- Re-sync (Sync catalog) to populate these on existing rows.

ALTER TABLE pb_finder_cache ADD COLUMN IF NOT EXISTS brand_id   text;
ALTER TABLE pb_finder_cache ADD COLUMN IF NOT EXISTS brand_mcid text;
