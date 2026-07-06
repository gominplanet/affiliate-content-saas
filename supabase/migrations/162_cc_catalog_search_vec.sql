-- ── 162: index-backed name+brand search for the CC catalog ──────────────────
-- Migration 161's FTS index was on the expression to_tsvector(name || brand),
-- but PostgREST's column text-search only matches to_tsvector(campaign_name) —
-- so brand-only keyword searches missed, and the index went unused (seq scan on
-- ~241k rows). A STORED generated tsvector column fixes both: it covers name +
-- brand and PostgREST can query it directly, hitting the GIN index.

ALTER TABLE cc_campaign_catalog
  ADD COLUMN IF NOT EXISTS search_vec tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', campaign_name || ' ' || coalesce(brand_name, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS cc_catalog_search_vec_idx
  ON cc_campaign_catalog USING gin (search_vec);

-- The old expression index is now redundant.
DROP INDEX IF EXISTS cc_catalog_fts_idx;
