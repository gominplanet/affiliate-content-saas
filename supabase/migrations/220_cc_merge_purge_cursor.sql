-- 220 — single-pass cursor purge for the catalog merge.
--
-- The stateless purge (migration 213) re-scanned the catalog from the top on
-- every batch to find the next N rows not in staging (NOT EXISTS ... LIMIT N).
-- As victims get deleted, each batch walks further to find the next N, so a
-- small differential purge degrades to O(rows × batches) — a ~50k-row purge on
-- a bloated catalog took hours.
--
-- This walks the catalog ONCE in primary-key (campaign_id) order, carrying a
-- cursor between calls, so total work is a single pass. Each call takes the next
-- p_limit campaign_ids after p_after (PK-ordered), deletes those not in staging,
-- and returns the cursor to resume from plus scanned/deleted counts. The caller
-- loops, passing last_id back as p_after, until scanned < p_limit (end reached).
--
-- The old merge_cc_catalog_purge_step (213) is intentionally LEFT IN PLACE so an
-- in-flight import running the previous client keeps working; the route picks
-- the cursor path only when the client sends a purgeAfter field.

CREATE OR REPLACE FUNCTION merge_cc_catalog_purge_cursor(
  p_limit int DEFAULT 5000,
  p_after text DEFAULT ''
)
RETURNS TABLE(last_id text, scanned int, deleted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH batch AS (
    -- The next window of catalog rows, in PK order, after the cursor.
    SELECT c.campaign_id
    FROM cc_campaign_catalog c
    WHERE c.campaign_id > p_after
    ORDER BY c.campaign_id
    LIMIT p_limit
  ),
  del AS (
    -- Delete the ones in this window that aren't in staging (fell out of the CSV).
    DELETE FROM cc_campaign_catalog c
    USING batch b
    WHERE c.campaign_id = b.campaign_id
      AND NOT EXISTS (
        SELECT 1 FROM cc_campaign_catalog_import s WHERE s.campaign_id = c.campaign_id
      )
    RETURNING 1
  )
  SELECT
    (SELECT max(campaign_id) FROM batch),   -- cursor: advance past everything considered
    (SELECT count(*)::int FROM batch),      -- scanned this call; < p_limit means we hit the end
    (SELECT count(*)::int FROM del);        -- deleted this call
END $$;

NOTIFY pgrst, 'reload schema';
