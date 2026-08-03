-- 218 — differential merge: only write rows that actually changed.
--
-- The weekly CSV is ~1M campaigns, but almost all already exist unchanged in the
-- catalog — the real diff is ~20-30k new/changed rows. The old merge upserted
-- EVERY staged row, so it re-wrote ~1M catalog rows a week, and every rewrite
-- churned the two GIN indexes (search_vec + asins) even when nothing changed.
-- That's the Disk IO spend + table/index bloat for no benefit.
--
-- This version adds a WHERE to the ON CONFLICT DO UPDATE so an existing row is
-- only rewritten when at least one tracked column differs (IS DISTINCT FROM).
-- Unchanged rows become no-ops: no new tuple, no GIN update, no IO. New rows
-- still insert; changed rows still update. Result: a 1M-row import touches only
-- the true diff (~25k), cutting weekly disk IO and bloat by ~97%.
--
-- IMPORTANT — the step must still RETURN how many staged rows it DRAINED (marked
-- _merged), NOT how many it changed. The endpoint's loop stops when a step
-- returns fewer than a full batch; if it returned the (tiny) changed-row count it
-- would quit after the first batch and leave most of the CSV unmerged. So we
-- count the `upd` CTE (rows marked _merged), not the insert's row count.
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
      available_slot   = EXCLUDED.available_slot,
      total_slot       = EXCLUDED.total_slot,
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
           EXCLUDED.available_slot, EXCLUDED.total_slot)
    RETURNING 1
  )
  -- Return rows DRAINED this batch (marked _merged), not rows changed, so the
  -- endpoint's "n < BATCH ⇒ done" logic still works. `ins` is a data-modifying
  -- CTE, so it runs even though the final SELECT doesn't reference it.
  SELECT count(*) INTO v FROM upd;
  RETURN v;
END $$;

NOTIFY pgrst, 'reload schema';
