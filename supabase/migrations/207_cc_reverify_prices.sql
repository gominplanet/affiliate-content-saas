-- 207 — Re-verify catalog prices: chunked, timeout-proof requeue.
--
-- The enrich cron reads the Buy Box price now (what a shopper actually pays),
-- but rows already enriched with the OLD Amazon/New price keep their stale
-- product_verified_at and won't be re-checked for up to CC_ENRICH_STALE_DAYS.
-- This function REQUEUES them: it nulls product_verified_at on live campaigns so
-- they jump to the front of the cron's oldest-first queue (nullsFirst) and get
-- re-priced on the next runs — WITHOUT clearing the signal columns, so Browse
-- filters keep working on the existing values until each row is refreshed.
--
-- p_before guards against fighting the cron: only rows verified BEFORE the pass
-- started are requeued, so a row the cron freshly re-priced (verified >= p_before)
-- is never nulled again. Bounded per call so no single UPDATE times out; the
-- endpoint loops until it drains.

CREATE OR REPLACE FUNCTION reverify_cc_prices_step(p_before timestamptz, p_limit int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v int;
BEGIN
  SET LOCAL statement_timeout = 0;
  WITH b AS (
    SELECT ctid FROM cc_campaign_catalog
    WHERE product_verified_at IS NOT NULL
      AND product_verified_at < p_before
      AND ends_at >= CURRENT_DATE
    LIMIT p_limit
  )
  UPDATE cc_campaign_catalog c
  SET product_verified_at = NULL
  FROM b WHERE c.ctid = b.ctid;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;

NOTIFY pgrst, 'reload schema';
