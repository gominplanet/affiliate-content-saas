-- 213 — chunked, timeout-safe purge for the catalog merge.
--
-- The merge's final step deleted every live campaign not in the new CSV in ONE
-- statement (a NOT EXISTS anti-join over ~800k rows). That can exceed the DB
-- statement timeout (SET LOCAL statement_timeout = 0 doesn't reliably override
-- it under the API role), which stalled the merge at the purge. This deletes the
-- fall-outs in bounded batches; the endpoint loops until none remain.
CREATE OR REPLACE FUNCTION merge_cc_catalog_purge_step(p_limit int DEFAULT 500)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v int;
BEGIN
  WITH victims AS (
    SELECT c.ctid
    FROM cc_campaign_catalog c
    WHERE NOT EXISTS (
      SELECT 1 FROM cc_campaign_catalog_import s WHERE s.campaign_id = c.campaign_id
    )
    LIMIT p_limit
  )
  DELETE FROM cc_campaign_catalog c
  USING victims
  WHERE c.ctid = victims.ctid;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN v;
END $$;

NOTIFY pgrst, 'reload schema';
