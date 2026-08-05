-- 223 — Creator Connections Intelligence
--
-- Surfaces the decision data that already lives in cc_campaign_catalog (imported
-- weekly from Amazon's CSV) but was never projected anywhere the creator can see
-- it: how full a campaign is (spots left of total), whether the brand is still
-- funding it (budget remaining), and when it ends.
--
-- Two parts:
--   1. Carry slots/budget/end-date onto deal_radar_cache so Deal Radar can badge
--      "3 spots left", "campaign full", "ending tomorrow" on any deal that maps
--      to a live campaign.
--   2. Widen match_deal_radar_campaigns() to stamp those fields (and clear them
--      when a campaign goes stale), same indexed pass it already runs each cron.
--
-- Brand payout-reliability is computed on the fly in the app from these same
-- columns aggregated by brand (budget actually consumed = brand pays out), so it
-- needs no new capture or table.

-- ── 1. New projected columns on the deal cache ──────────────────────────────
alter table public.deal_radar_cache
  add column if not exists campaign_available_slot integer,
  add column if not exists campaign_total_slot integer,
  add column if not exists campaign_budget_remaining numeric,
  add column if not exists campaign_ends_at date;

-- ── 2. Stamp them in the same match pass ────────────────────────────────────
CREATE OR REPLACE FUNCTION match_deal_radar_campaigns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched integer;
BEGIN
  WITH best AS (
    SELECT DISTINCT ON (d.asin)
      d.asin,
      c.campaign_id,
      c.commission_pct,
      c.brand_name,
      c.available_slot,
      c.total_slot,
      c.budget_remaining,
      c.ends_at
    FROM deal_radar_cache d
    JOIN cc_campaign_catalog c ON c.asins @> ARRAY[d.asin]
    WHERE c.ends_at >= current_date
      AND coalesce(c.commission_pct, 0) > 0
      AND (c.budget_remaining IS NULL OR c.budget_remaining > 0)
      AND (c.available_slot   IS NULL OR c.available_slot   > 0)
    ORDER BY d.asin, c.commission_pct DESC
  )
  UPDATE deal_radar_cache d
  SET campaign_id               = best.campaign_id,
      campaign_commission_pct   = best.commission_pct,
      campaign_brand            = best.brand_name,
      campaign_details_url      = 'https://affiliate-program.amazon.com/creatorconnections/campaign/' || best.campaign_id,
      campaign_available_slot   = best.available_slot,
      campaign_total_slot       = best.total_slot,
      campaign_budget_remaining = best.budget_remaining,
      campaign_ends_at          = best.ends_at
  FROM best
  WHERE d.asin = best.asin
    AND d.campaign_id IS DISTINCT FROM best.campaign_id;

  GET DIAGNOSTICS matched = ROW_COUNT;

  -- Clear stale matches (campaign expired / no longer covers the ASIN).
  UPDATE deal_radar_cache d
  SET campaign_id = NULL,
      campaign_commission_pct = NULL,
      campaign_brand = NULL,
      campaign_details_url = NULL,
      campaign_available_slot = NULL,
      campaign_total_slot = NULL,
      campaign_budget_remaining = NULL,
      campaign_ends_at = NULL
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

GRANT EXECUTE ON FUNCTION match_deal_radar_campaigns() TO service_role;
