-- 403: campaigns missing from Amazon's export are marked full, not deleted.
--
-- Amazon's "Download all available campaigns" export leaves out campaigns that
-- can no longer be joined. Add-only uploads (the default since a short export
-- nearly purged 514,994 rows) kept those rows with their old spot counts, so a
-- full campaign kept showing "44 of 800 spots left". Spot check: 5 of 5 sampled
-- campaigns missing from the export were full on Amazon.
--
-- This walks the catalogue once in campaign_id order, like the purge (220),
-- and sets available_slot to 0 on rows that still show open spots but are not
-- in staging. Nothing is deleted and enrichment stays. The "Has open spots"
-- filter hides them; a later export or a live refresh that includes a campaign
-- sets its real count again.
--
-- Safe to run twice.

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

REVOKE ALL ON FUNCTION hide_cc_missing_cursor(int, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hide_cc_missing_cursor(int, text) TO service_role;

NOTIFY pgrst, 'reload schema';
