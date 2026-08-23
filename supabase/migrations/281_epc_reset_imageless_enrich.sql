-- 281 — one-time re-enrichment of EPC rows left imageless by the images[] fix.
--
-- Early EPC enrichment read the product image from Keepa's `imagesCSV`, which is
-- null for Sponsored Products — the image actually lives in the `images[]` array.
-- Rows enriched before that fix have enriched_at set but image_url null. The
-- enrichment gate is now "enriched_at IS NULL" only (so a product Keepa genuinely
-- has no image for isn't retried forever), which means those pre-fix rows would
-- never get another pass. Null their enriched_at ONCE so the paced cron / the
-- "Fill in images" button re-enrich them with the corrected images[] reader. A
-- product that still comes back with no image keeps enriched_at set afterwards and
-- is not retried again.

update public.epc_products
  set enriched_at = null
  where image_url is null;

notify pgrst, 'reload schema';
