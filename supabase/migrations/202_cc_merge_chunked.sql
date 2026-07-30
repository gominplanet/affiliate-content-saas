-- 202 — Chunked, timeout-proof, resumable CC catalog merge.
--
-- A single-statement upsert of ~692k rows (with all the catalog indexes) is too
-- slow for one synchronous RPC — it times out ("Import merge failed"). Instead
-- the merge now runs in CHUNKS driven by the endpoint: each call upserts a bounded
-- batch and returns fast, so nothing hits a statement/gateway/function timeout.
-- A `_merged` marker makes it RESUMABLE — if the endpoint dies partway, clicking
-- Merge again continues from where it stopped. The final purge (delete campaigns
-- not in the new CSV) is one indexed anti-join.

ALTER TABLE cc_campaign_catalog_import
  ADD COLUMN IF NOT EXISTS _merged boolean NOT NULL DEFAULT false;

-- Upsert up to p_limit not-yet-merged staged rows into the live catalog, marking
-- them merged. Returns how many it processed (0 = nothing left).
CREATE OR REPLACE FUNCTION merge_cc_catalog_step(p_limit int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v int;
BEGIN
  SET LOCAL statement_timeout = 0;
  WITH b AS (
    SELECT campaign_id FROM cc_campaign_catalog_import WHERE _merged = false LIMIT p_limit
  ), upd AS (
    UPDATE cc_campaign_catalog_import s SET _merged = true
    FROM b WHERE s.campaign_id = b.campaign_id
    RETURNING s.campaign_id
  )
  INSERT INTO cc_campaign_catalog AS c
    (campaign_id, campaign_name, brand_name, asins, commission_pct,
     starts_at, ends_at, budget, budget_remaining, available_slot, total_slot, imported_at)
  SELECT s.campaign_id, s.campaign_name, s.brand_name, s.asins, s.commission_pct,
         s.starts_at, s.ends_at, s.budget, s.budget_remaining, s.available_slot, s.total_slot, now()
  FROM cc_campaign_catalog_import s JOIN upd u ON u.campaign_id = s.campaign_id
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
    -- Signal columns intentionally NOT updated, so enrichment survives.
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;

-- Delete every live campaign not present in the latest staged CSV (the fall-outs).
CREATE OR REPLACE FUNCTION merge_cc_catalog_purge()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v bigint;
BEGIN
  SET LOCAL statement_timeout = 0;
  DELETE FROM cc_campaign_catalog c
  WHERE NOT EXISTS (
    SELECT 1 FROM cc_campaign_catalog_import s WHERE s.campaign_id = c.campaign_id
  );
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;

NOTIFY pgrst, 'reload schema';
