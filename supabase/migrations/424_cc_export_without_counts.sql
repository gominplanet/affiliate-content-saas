-- 424: Amazon's export has no spot counts; MVP works without them.
--
-- 2026-10-10: Amazon's "available campaigns" export no longer carries Open or
-- Total slots (its columns end at Budget Remaining). Being IN the export is
-- what says a campaign can be joined. So:
--
--   1. The merge writes "open, count unknown" (NULL) for a campaign in the
--      upload that has no count, replacing a stale 0. A positive count, or a
--      live count from the last 24 hours (SCOUT), is kept.
--   2. The hide pass marks full every campaign NOT in the upload, including
--      ones whose count is unknown. (Replaces 423's "no counts, hide nothing",
--      which would have left the catalogue empty with Amazon's new export.)
--   3. An index for "Has open spots" now meaning open OR count unknown.
--
-- The upload-size check that stops a partial upload from marking most of the
-- catalogue full lives in the app (250,000 rows and 30% of live campaigns).
--
-- Safe to run twice (CREATE OR REPLACE, CREATE INDEX IF NOT EXISTS). The index
-- build reads the whole table once; allow a minute.

SET statement_timeout = 0;

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
      -- No count in the upload (Amazon's export has none): a campaign in it is
      -- joinable, so a stale 0 becomes "open, count unknown" (NULL). A positive
      -- count, or a live count from the last day, is kept.
      available_slot   = CASE WHEN EXCLUDED.available_slot IS NOT NULL THEN EXCLUDED.available_slot WHEN c.available_slot > 0 THEN c.available_slot WHEN c.last_live_at > now() - interval '24 hours' THEN c.available_slot ELSE NULL END,
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
           CASE WHEN EXCLUDED.available_slot IS NOT NULL THEN EXCLUDED.available_slot WHEN c.available_slot > 0 THEN c.available_slot WHEN c.last_live_at > now() - interval '24 hours' THEN c.available_slot ELSE NULL END, COALESCE(EXCLUDED.total_slot, c.total_slot))
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
      -- Open, or open with the count unknown: either way not in the export means full.
      AND (c.available_slot > 0 OR c.available_slot IS NULL)
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

CREATE INDEX IF NOT EXISTS cc_catalog_open_or_unknown_idx
  ON public.cc_campaign_catalog (commission_pct DESC NULLS LAST)
  WHERE (available_slot IS NULL OR available_slot > 0);

ANALYZE public.cc_campaign_catalog;

NOTIFY pgrst, 'reload schema';
