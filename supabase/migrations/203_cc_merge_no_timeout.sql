-- 203 — Merge functions: lift the statement timeout at the FUNCTION level.
--
-- `SET LOCAL statement_timeout = 0` inside the function body did NOT reliably
-- override Supabase's per-request statement_timeout, so the merge/purge died with
-- "canceling statement due to statement timeout". A function-level SET is applied
-- by Postgres on function ENTRY and reverted on exit, which reliably disables the
-- timeout for the whole step/purge. Idempotent CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION merge_cc_catalog_step(p_limit int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $$
DECLARE v int;
BEGIN
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
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION merge_cc_catalog_purge()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $$
DECLARE v bigint;
BEGIN
  DELETE FROM cc_campaign_catalog c
  WHERE NOT EXISTS (
    SELECT 1 FROM cc_campaign_catalog_import s WHERE s.campaign_id = c.campaign_id
  );
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;

NOTIFY pgrst, 'reload schema';
