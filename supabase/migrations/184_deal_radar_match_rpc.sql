-- 184 — Deal Radar: full-cache Creator Connections match as a set-based RPC.
--
-- WHY: the refresh cron only ever matched the ASINs in the *current* Keepa sweep
-- (deals.map(d => d.asin)). Live deals rotate every run, so the overlapping ASINs
-- that accumulate in the cache across many runs were almost never re-matched — and
-- any deal first swept while cc_campaign_catalog was still empty (pre-import) got
-- stamped null and nothing ever revisited it. Net effect: real overlaps existed
-- (the `@>` GIN join finds them) but campaign_id stayed null, so the "Creator
-- Connections" filter showed nothing.
--
-- FIX: match the ENTIRE cache against the catalog in one indexed pass, every run.
-- Idempotent — stamps rows that now match, clears rows that no longer do. The
-- cron calls this via `rpc('match_deal_radar_campaigns')` after each upsert.
--
-- "Active" campaign = not expired, commission > 0, budget left, slots left (null
-- budget/slot = unknown/unlimited → allowed). Best = highest commission per ASIN.

CREATE OR REPLACE FUNCTION match_deal_radar_campaigns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched integer;
BEGIN
  -- 1. Stamp the best active campaign onto every cached ASIN that has one.
  WITH best AS (
    SELECT DISTINCT ON (d.asin)
      d.asin,
      c.campaign_id,
      c.commission_pct,
      c.brand_name
    FROM deal_radar_cache d
    JOIN cc_campaign_catalog c ON c.asins @> ARRAY[d.asin]
    WHERE c.ends_at >= current_date
      AND coalesce(c.commission_pct, 0) > 0
      AND (c.budget_remaining IS NULL OR c.budget_remaining > 0)
      AND (c.available_slot   IS NULL OR c.available_slot   > 0)
    ORDER BY d.asin, c.commission_pct DESC
  )
  UPDATE deal_radar_cache d
  SET campaign_id             = best.campaign_id,
      campaign_commission_pct = best.commission_pct,
      campaign_brand          = best.brand_name,
      campaign_details_url    = 'https://affiliate-program.amazon.com/creatorconnections/campaign/' || best.campaign_id
  FROM best
  WHERE d.asin = best.asin
    AND d.campaign_id IS DISTINCT FROM best.campaign_id;

  GET DIAGNOSTICS matched = ROW_COUNT;

  -- 2. Clear stale matches: rows still carrying a campaign that is no longer
  --    active / no longer covers the ASIN.
  UPDATE deal_radar_cache d
  SET campaign_id = NULL,
      campaign_commission_pct = NULL,
      campaign_brand = NULL,
      campaign_details_url = NULL
  WHERE d.campaign_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM cc_campaign_catalog c
      WHERE c.asins @> ARRAY[d.asin]
        AND c.ends_at >= current_date
        AND coalesce(c.commission_pct, 0) > 0
        AND (c.budget_remaining IS NULL OR c.budget_remaining > 0)
        AND (c.available_slot   IS NULL OR c.available_slot   > 0)
    );

  RETURN matched;
END;
$$;

-- Callable by the service role (the cron) and authenticated users are irrelevant
-- here — only the cron invokes it. Grant to service_role explicitly.
GRANT EXECUTE ON FUNCTION match_deal_radar_campaigns() TO service_role;
