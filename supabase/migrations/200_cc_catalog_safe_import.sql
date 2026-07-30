-- 200 — Safe, signal-preserving weekly re-import of the CC campaign catalog.
--
-- PROBLEM: the catalog is refreshed ~weekly from Amazon's CSV by REPLACING the
-- table. That wipes the enriched product signals (image / sales / rating /
-- videos in migration 197) every week, forcing a full, expensive Keepa
-- re-enrichment of ~200k products each time.
--
-- FIX: load the weekly CSV into a STAGING table, then MERGE it into the live
-- catalog: upsert ONLY the campaign-economics columns (leaving the signal
-- columns untouched, so enrichment survives), and purge campaigns that fell out
-- of the latest CSV. New campaigns arrive with null signals; the paced
-- enrichment cron (product_verified_at ASC NULLS FIRST) fills those first.
--
-- Weekly workflow becomes: load CSV → cc_campaign_catalog_import, then call
-- /api/admin/import-cc-catalog (which runs merge_cc_catalog_import()).

-- Staging table: MIRRORS the live catalog's campaign columns (no signal columns).
-- Load your weekly CSV into THIS table (replace it freely — it holds nothing
-- precious), then merge.
CREATE TABLE IF NOT EXISTS cc_campaign_catalog_import (
  campaign_id       text PRIMARY KEY,
  campaign_name     text NOT NULL,
  brand_name        text,
  asins             text[] NOT NULL DEFAULT '{}',
  commission_pct    numeric NOT NULL,
  starts_at         date,
  ends_at           date NOT NULL,
  budget            numeric,
  budget_remaining  numeric,
  available_slot    integer,
  total_slot        integer
);

ALTER TABLE cc_campaign_catalog_import ENABLE ROW LEVEL SECURITY;
-- No policies: service-role / dashboard only (same posture as the live catalog).

-- Merge staging → live catalog. Upserts campaign columns only (signals survive),
-- purges fall-outs. Returns how many rows were upserted / purged.
CREATE OR REPLACE FUNCTION merge_cc_catalog_import()
RETURNS TABLE(upserted bigint, purged bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_up bigint; v_del bigint;
BEGIN
  INSERT INTO cc_campaign_catalog AS c
    (campaign_id, campaign_name, brand_name, asins, commission_pct,
     starts_at, ends_at, budget, budget_remaining, available_slot, total_slot, imported_at)
  SELECT campaign_id, campaign_name, brand_name, asins, commission_pct,
         starts_at, ends_at, budget, budget_remaining, available_slot, total_slot, now()
  FROM cc_campaign_catalog_import
  ON CONFLICT (campaign_id) DO UPDATE SET
    campaign_name    = EXCLUDED.campaign_name,
    brand_name       = EXCLUDED.brand_name,
    asins            = EXCLUDED.asins,
    commission_pct   = EXCLUDED.commission_pct,
    starts_at        = EXCLUDED.starts_at,
    ends_at          = EXCLUDED.ends_at,
    budget           = EXCLUDED.budget,
    budget_remaining = EXCLUDED.budget_remaining,
    available_slot   = EXCLUDED.available_slot,
    total_slot       = EXCLUDED.total_slot,
    imported_at      = now();
    -- NB: signal columns (image_url, price_*, rating, review_count,
    -- monthly_sold, video_count, product_verified_at) are deliberately NOT in
    -- the SET list, so a re-import preserves every product's enrichment.
  GET DIAGNOSTICS v_up = ROW_COUNT;

  DELETE FROM cc_campaign_catalog
  WHERE campaign_id NOT IN (SELECT campaign_id FROM cc_campaign_catalog_import);
  GET DIAGNOSTICS v_del = ROW_COUNT;

  RETURN QUERY SELECT v_up, v_del;
END $$;

NOTIFY pgrst, 'reload schema';
