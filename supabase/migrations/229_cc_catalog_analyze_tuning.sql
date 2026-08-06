-- 229 — Keep the CC catalog's row-count ESTIMATES fresh.
--
-- The admin CC-import card shows ESTIMATED counts (count: 'estimated' via
-- PostgREST → the planner's reltuples / column stats), because an exact COUNT
-- over ~800k rows hits the statement timeout. Those estimates only refresh when
-- ANALYZE runs. On this big, steadily-updated table (enrichment stamps
-- product_verified_at on thousands of rows a day) autovacuum's default ANALYZE
-- cadence lagged for many hours, so the "Enriched (signals)" number sat frozen
-- while the real count climbed underneath it, reading as "stuck all day."
--
-- ANALYZE can't be run from the app (it can't execute inside a transaction, so
-- not from a PostgREST RPC), so instead we make autovacuum ANALYZE this table
-- far more often: after ~25k row changes regardless of table size (the default
-- scale_factor of 0.1 would need ~80k changes on an 800k table). That keeps the
-- planner stats, and therefore the card, within ~25k of reality.

ALTER TABLE cc_campaign_catalog SET (
  autovacuum_analyze_scale_factor = 0,
  autovacuum_analyze_threshold   = 25000
);

-- Refresh stats once now so the card corrects immediately rather than waiting
-- for the next autovacuum pass. (Runs as a standalone statement, not in a txn.)
ANALYZE cc_campaign_catalog;
