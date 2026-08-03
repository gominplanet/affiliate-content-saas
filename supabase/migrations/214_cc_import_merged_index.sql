-- 214 — keep the chunked merge fast from the first batch to the last.
--
-- merge_cc_catalog_step picks the next slice with
--   SELECT campaign_id FROM cc_campaign_catalog_import WHERE _merged = false LIMIT p_limit
-- With no index on _merged, that's a sequential scan. On the first batch it's
-- cheap (it stops after 150 unmerged rows), but as merging advances the scan has
-- to skip over an ever-growing block of already-merged rows before it finds 150
-- fresh ones — so each batch gets slower and eventually hits the statement
-- timeout even at a small batch size. A PARTIAL index on the unmerged rows keeps
-- "find the next slice" O(1)-ish the whole way through: it only holds the rows
-- still to do, and shrinks as they merge.
CREATE INDEX IF NOT EXISTS cc_import_unmerged_idx
  ON cc_campaign_catalog_import (campaign_id)
  WHERE _merged = false;

NOTIFY pgrst, 'reload schema';
