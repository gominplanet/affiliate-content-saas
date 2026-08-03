-- 211 — Recover the ASIN from the campaign name when the asins[] column is empty.
--
-- Thousands of CC campaigns import with an empty asins[] — the ASIN lives only
-- in the campaign name (e.g. "B0FHK9DYTC 6L Cool Mist Humidifier 10%"). That hid
-- them from Browse (needs an ASIN) and from enrichment (rep_asin = asins[1] was
-- null). Browse already recovers it at read time; this does it in the DATA so
-- rep_asin fills and the enrich cron can reach them.
--
-- Two parts:
--   1. cc_effective_asins() + a merge that uses it, so EVERY FUTURE IMPORT lands
--      with asins populated (no empty-asin rows going forward).
--   2. backfill_cc_asins_step() — a paced, cursor-based backfill for the rows
--      already in the catalog (small batches: updating asins churns the asins
--      GIN + rep_asin indexes, so a big statement would time out).

-- The asins we should store: the uploaded array if it has anything, else the
-- B0-prefixed ASIN pulled out of the campaign name, else whatever we had.
CREATE OR REPLACE FUNCTION cc_effective_asins(p_asins text[], p_name text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_asins IS NOT NULL AND array_length(p_asins, 1) >= 1 THEN p_asins
    WHEN p_name ~ 'B0[A-Z0-9]{8}' THEN ARRAY[(regexp_match(p_name, 'B0[A-Z0-9]{8}'))[1]]
    ELSE p_asins
  END
$$;

-- Re-create the chunked merge (migration 202) with the ASIN recovery baked into
-- the asins column, so future imports never land with an empty asins[] when the
-- name carries the ASIN.
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
    imported_at      = now();
    -- Signal columns intentionally NOT updated, so enrichment survives.
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;

-- Paced backfill for existing rows: page by primary key, and for each page fill
-- asins from the campaign name on the rows that have an empty asins[] and a
-- B0-ASIN in the name. Small p_limit so the asins-GIN / rep_asin index churn
-- stays under the statement timeout; the endpoint loops with an `after` cursor.
CREATE OR REPLACE FUNCTION backfill_cc_asins_step(p_after text, p_limit int DEFAULT 400)
RETURNS TABLE(last_id text, scanned int, updated int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH page AS (
    SELECT campaign_id, asins, campaign_name
    FROM cc_campaign_catalog
    WHERE campaign_id > p_after
    ORDER BY campaign_id
    LIMIT p_limit
  ), upd AS (
    UPDATE cc_campaign_catalog c
    SET asins = ARRAY[(regexp_match(page.campaign_name, 'B0[A-Z0-9]{8}'))[1]]
    FROM page
    WHERE c.campaign_id = page.campaign_id
      AND (page.asins IS NULL OR array_length(page.asins, 1) IS NULL)
      AND page.campaign_name ~ 'B0[A-Z0-9]{8}'
    RETURNING c.campaign_id
  )
  SELECT
    (SELECT max(campaign_id) FROM page)::text,
    (SELECT count(*) FROM page)::int,
    (SELECT count(*) FROM upd)::int;
END $$;

NOTIFY pgrst, 'reload schema';
