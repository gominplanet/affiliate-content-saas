-- 208 — Re-verify requeue, cursor edition (fixes the statement timeout).
--
-- 207's function filtered on product_verified_at and re-scanned from the front
-- each resume. As it nulled rows, the "IS NOT NULL" scan had to skip an ever-
-- growing pile of nulls to find work, so later calls slowed until they hit the
-- statement timeout ("canceling statement due to statement timeout"). SET LOCAL
-- statement_timeout = 0 didn't save it under the API role.
--
-- This version pages through the table by PRIMARY KEY (campaign_id) with a
-- cursor: each call scans exactly p_limit rows once, via the PK index, and nulls
-- product_verified_at on the live+enriched ones in that page. No re-scanning, no
-- null-skip blowup — every call is O(p_limit) and finishes fast. The endpoint
-- passes last_id back as the cursor until a page comes back short (end of table).

DROP FUNCTION IF EXISTS reverify_cc_prices_step(timestamptz, int);

CREATE OR REPLACE FUNCTION reverify_cc_prices_step(p_after text, p_limit int DEFAULT 5000)
RETURNS TABLE(last_id text, scanned int, updated int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH page AS (
    SELECT campaign_id, ends_at, product_verified_at
    FROM cc_campaign_catalog
    WHERE campaign_id > p_after
    ORDER BY campaign_id
    LIMIT p_limit
  ), upd AS (
    UPDATE cc_campaign_catalog c
    SET product_verified_at = NULL
    FROM page
    WHERE c.campaign_id = page.campaign_id
      AND page.product_verified_at IS NOT NULL
      AND page.ends_at >= CURRENT_DATE
    RETURNING c.campaign_id
  )
  SELECT
    (SELECT max(campaign_id) FROM page)::text,
    (SELECT count(*) FROM page)::int,
    (SELECT count(*) FROM upd)::int;
END $$;

NOTIFY pgrst, 'reload schema';
