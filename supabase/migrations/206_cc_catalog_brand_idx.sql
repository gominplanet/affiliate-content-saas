-- 206 — Index cc_campaign_catalog by brand.
--
-- WHY: Creator Connections messaging is per-BRAND, not per-campaign — one chat
-- thread per brand. So "Send on Creator Connections" can message a brand through
-- ANY of that brand's campaigns, which matters when the exact product's campaign
-- has ended. catalog-by-asin now looks up other LIVE campaigns for the same
-- brand as a fallback (brand_name = $1 AND ends_at >= today), and that eq-filter
-- needs a btree index or it seq-scans ~836k rows on every send.

CREATE INDEX IF NOT EXISTS cc_catalog_brand_idx
  ON public.cc_campaign_catalog (brand_name);
