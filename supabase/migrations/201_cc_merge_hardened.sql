-- 201 — Harden merge_cc_catalog_import() for the full ~674k-row weekly merge.
--
-- The merge upserts every staged campaign and deletes every live campaign not in
-- staging. At full scale (hundreds of thousands of rows) the default per-role
-- statement_timeout can kill it mid-way ("Import merge failed"). This:
--   1. Lifts the statement timeout for the duration of the merge only (SET LOCAL,
--      scoped to this SECURITY DEFINER call — does not change global settings).
--   2. Uses a NOT EXISTS anti-join for the purge (indexed on both PKs), which is
--      far faster than NOT IN over a large subquery.
-- Idempotent: CREATE OR REPLACE, safe to run on top of migration 200.

CREATE OR REPLACE FUNCTION merge_cc_catalog_import()
RETURNS TABLE(upserted bigint, purged bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_up bigint; v_del bigint;
BEGIN
  -- No timeout for this bulk merge (scoped to this call only).
  SET LOCAL statement_timeout = 0;

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
    -- Signal columns intentionally NOT updated, so enrichment survives.
  GET DIAGNOSTICS v_up = ROW_COUNT;

  DELETE FROM cc_campaign_catalog c
  WHERE NOT EXISTS (
    SELECT 1 FROM cc_campaign_catalog_import s WHERE s.campaign_id = c.campaign_id
  );
  GET DIAGNOSTICS v_del = ROW_COUNT;

  RETURN QUERY SELECT v_up, v_del;
END $$;

NOTIFY pgrst, 'reload schema';
