-- ── 161: shared Creator Connections campaign catalog ────────────────────────
-- ONE global catalog (not per-user): the admin imports Amazon's full campaigns
-- CSV export (~678k rows; only rule-passing campaigns are stored, ~241k) and
-- EVERY user's "Campaigns ON" search on the AMZ Product Finder queries it
-- instantly — no SCOUT scan, no Amazon traffic — with SCOUT doing only the
-- final per-ASIN live verification. Refreshed by re-running the import
-- (upsert on campaign_id + purge of rows older than the import).

CREATE TABLE IF NOT EXISTS cc_campaign_catalog (
  campaign_id       text PRIMARY KEY,           -- amzn1.campaign.…
  campaign_name     text NOT NULL,
  brand_name        text,
  asins             text[] NOT NULL DEFAULT '{}',
  commission_pct    numeric NOT NULL,
  starts_at         date,
  ends_at           date NOT NULL,
  budget            numeric,
  budget_remaining  numeric,
  available_slot    integer,
  total_slot        integer,
  imported_at       timestamptz NOT NULL DEFAULT now()
);

-- Keyword search over name + brand (websearch-style queries).
CREATE INDEX IF NOT EXISTS cc_catalog_fts_idx
  ON cc_campaign_catalog
  USING gin (to_tsvector('english', campaign_name || ' ' || coalesce(brand_name, '')));

-- Fast "is this ASIN in any campaign?" lookups (Check CC without Amazon).
CREATE INDEX IF NOT EXISTS cc_catalog_asins_idx
  ON cc_campaign_catalog USING gin (asins);

-- The default ranking path: best commission first among still-running campaigns.
CREATE INDEX IF NOT EXISTS cc_catalog_rank_idx
  ON cc_campaign_catalog (commission_pct DESC, ends_at);

-- Shared read for every signed-in user; writes only via the service role
-- (the import script / admin refresh endpoint).
ALTER TABLE cc_campaign_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cc_catalog_read_all" ON cc_campaign_catalog;
CREATE POLICY "cc_catalog_read_all" ON cc_campaign_catalog
  FOR SELECT TO authenticated USING (true);
-- (no INSERT/UPDATE/DELETE policies: service-role only)
