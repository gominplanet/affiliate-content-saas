-- 181 — Amazon Deal Radar: cached live-deals feed (Keepa) + campaign cross-check.
--
-- ONE global, service-role-written cache (not per-user): a deal is the same fact
-- for everyone, so a central cron pulls Keepa's live deals a few times a day and
-- every user's Deal Radar reads this table instantly — no per-user Keepa calls.
-- Cost scales with categories × refresh cadence, never with user count.
--
-- The Amazon Creator Connections match is PRECOMPUTED onto each row by the same
-- cron (campaign_id / campaign_commission_pct / campaign_brand), so the
-- "double-win" ticker (on sale AND has a bounty) is one indexed read. It's
-- sourced from the shared cc_campaign_catalog (global). The per-user network
-- overlay (Levanta / PartnerBoost — only the brands a creator has actually
-- joined) is matched at read time off each user's own keys, NOT stored here.
--
-- Prices are stored in CENTS (integers) so filters/sorts never touch floats.

CREATE TABLE IF NOT EXISTS deal_radar_cache (
  asin                    text PRIMARY KEY,          -- one row per product; upsert on refresh
  title                   text NOT NULL,
  brand                   text,
  image_url               text,
  category_id             integer,                    -- Keepa root category (browse node)

  price_now_cents         integer,
  price_was_cents         integer,
  discount_pct            integer,                    -- 1–99
  rating                  numeric,                    -- 0–5
  review_count            integer,
  sales_rank              integer,                    -- lower = better seller

  deal_type               text NOT NULL DEFAULT 'price_drop', -- price_drop | lightning
  lightning_ends_at       timestamptz,

  -- Precomputed Amazon Creator Connections cross-check (Phase 2 fills these; the
  -- cron upserts them alongside the deal). Null = no active CC campaign for this
  -- ASIN. commission_pct is the best still-running, in-budget, slots-available
  -- campaign's rate.
  campaign_id             text,
  campaign_commission_pct numeric,
  campaign_brand          text,
  campaign_details_url    text,

  first_seen_at           timestamptz NOT NULL DEFAULT now(),
  refreshed_at            timestamptz NOT NULL DEFAULT now(),

  -- Generated full-text column so the API can do `.textSearch('fts', q)` with a
  -- websearch-style query over title + brand.
  fts tsvector GENERATED ALWAYS AS (
    to_tsvector('english', title || ' ' || coalesce(brand, ''))
  ) STORED
);

-- Deal Radar's default sort + the freshness sweep (stale rows are purged after
-- N hours by the cron so the feed never shows dead deals).
CREATE INDEX IF NOT EXISTS deal_radar_refreshed_idx  ON deal_radar_cache (refreshed_at DESC);
CREATE INDEX IF NOT EXISTS deal_radar_discount_idx   ON deal_radar_cache (discount_pct DESC);
CREATE INDEX IF NOT EXISTS deal_radar_category_idx   ON deal_radar_cache (category_id, discount_pct DESC);
-- The double-win ticker: deals that carry a CC commission, best bounty first.
-- Partial index keeps it tiny (only matched rows).
CREATE INDEX IF NOT EXISTS deal_radar_campaign_idx
  ON deal_radar_cache (campaign_commission_pct DESC)
  WHERE campaign_commission_pct IS NOT NULL;
-- Keyword search over title + brand (websearch-style queries).
CREATE INDEX IF NOT EXISTS deal_radar_fts_idx ON deal_radar_cache USING gin (fts);

-- Shared read for every signed-in user; writes only via the service role (the
-- refresh cron). Same posture as cc_campaign_catalog.
ALTER TABLE deal_radar_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deal_radar_read_all" ON deal_radar_cache;
CREATE POLICY "deal_radar_read_all" ON deal_radar_cache
  FOR SELECT TO authenticated USING (true);
-- (no INSERT/UPDATE/DELETE policies: service-role only)
