-- 254 — Add a coarse category to the storefront product-card cache.
--
-- Powers the "Revenue by category" chart on the AMZ Storefront dashboard.
-- Filled from Keepa's productGroup (e.g. "Kitchen", "Health & Household") when
-- a card is (re)enriched; null until then. Service-role written like the rest
-- of the table (RLS already grants signed-in users SELECT only — migration 253).
ALTER TABLE storefront_product_cards ADD COLUMN IF NOT EXISTS category text;
