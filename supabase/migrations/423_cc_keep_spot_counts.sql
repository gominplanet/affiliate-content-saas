-- 423: an upload with no open-slots counts can never empty the catalogue.
--
-- 2026-10-10: an upload of 105,838 rows had no "Open slots" column mapped.
-- The merge wrote "no count" over every count it had, and "Hide campaigns
-- missing from this upload" then set the other ~850,000 live campaigns to
-- full. "Has open spots" hid the whole catalogue from every member.
--
--   1. The merge keeps an existing open/total slot count when the upload has
--      none for that campaign (COALESCE), instead of erasing it.
--   2. The hide pass marks nothing full when no staged row carries a count.
--
-- Safe to run twice (CREATE OR REPLACE only, no data changed).

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
  ), ins AS (
    INSERT INTO cc_campaign_catalog AS c
      (campaign_id, campaign_name, brand_name, asins, commission_pct,
       starts_at, ends_at, budget, budget_remaining, available_slot, total_slot, imported_at)
    SELECT s.campaign_id, s.campaign_name, s.brand_name,
           cc_effective_asins(s.asins, s.campaign_name), s.commission_pct,
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
      -- An upload with no count keeps the count MVP already has.
      available_slot   = COALESCE(EXCLUDED.available_slot, c.available_slot),
      total_slot       = COALESCE(EXCLUDED.total_slot, c.total_slot),
      imported_at      = now()
    -- Skip the rewrite when nothing tracked actually changed. Signal columns
    -- (image/price/rating/sales/video) are never touched here, so enrichment
    -- survives regardless. imported_at is intentionally NOT in the comparison —
    -- we don't rewrite a row just to bump a timestamp.
    WHERE (c.campaign_name, c.brand_name, c.asins, c.commission_pct,
           c.starts_at, c.ends_at, c.budget, c.budget_remaining,
           c.available_slot, c.total_slot)
      IS DISTINCT FROM
          (EXCLUDED.campaign_name, EXCLUDED.brand_name, EXCLUDED.asins, EXCLUDED.commission_pct,
           EXCLUDED.starts_at, EXCLUDED.ends_at, EXCLUDED.budget, EXCLUDED.budget_remaining,
           COALESCE(EXCLUDED.available_slot, c.available_slot), COALESCE(EXCLUDED.total_slot, c.total_slot))
    RETURNING 1
  )
  -- Return rows DRAINED this batch (marked _merged), not rows changed, so the
  -- endpoint's "n < BATCH ⇒ done" logic still works. `ins` is a data-modifying
  -- CTE, so it runs even though the final SELECT doesn't reference it.
  SELECT count(*) INTO v FROM upd;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION hide_cc_missing_cursor(
  p_limit int DEFAULT 5000,
  p_after text DEFAULT ''
)
RETURNS TABLE(last_id text, scanned int, hidden int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SET LOCAL statement_timeout = 0;
  -- An upload with no open-slots counts cannot say what is full: mark nothing.
  IF NOT EXISTS (SELECT 1 FROM cc_campaign_catalog_import WHERE available_slot IS NOT NULL) THEN
    RETURN QUERY SELECT NULL::text, 0, 0;
    RETURN;
  END IF;
  RETURN QUERY
  WITH batch AS (
    SELECT c.campaign_id
    FROM cc_campaign_catalog c
    WHERE c.campaign_id > p_after
    ORDER BY c.campaign_id
    LIMIT p_limit
  ),
  upd AS (
    UPDATE cc_campaign_catalog c
    SET available_slot = 0
    FROM batch b
    WHERE c.campaign_id = b.campaign_id
      AND c.available_slot > 0
      AND NOT EXISTS (
        SELECT 1 FROM cc_campaign_catalog_import s WHERE s.campaign_id = c.campaign_id
      )
    RETURNING 1
  )
  SELECT
    (SELECT max(campaign_id) FROM batch),
    (SELECT count(*)::int FROM batch),
    (SELECT count(*)::int FROM upd);
END $$;

NOTIFY pgrst, 'reload schema';
