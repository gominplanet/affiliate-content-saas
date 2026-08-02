-- 209 — priced_v2 flag: which catalog rows carry the corrected Buy Box price.
--
-- Mass-nulling product_verified_at to force a re-price kept blowing the DB
-- statement timeout: that column is indexed, so the update is non-HOT and
-- re-inserts every touched row into the search_vec + asins GIN indexes (slow),
-- and SET LOCAL statement_timeout doesn't override the limit under the API role.
--
-- Instead of a giant update, this flag lets the price refresh happen where it's
-- already cheap: the on-demand enrichment on a Smart Scan (a handful of rows per
-- scan) and the paced enrich cron. Both set priced_v2 = true when they write a
-- card with the Buy Box logic. Anything still false is a candidate to refresh —
-- so visible rows self-heal the moment someone scans that niche, and the cron
-- chips away at the rest, with no big write and no timeout.
--
-- Adding a boolean column with a constant default is metadata-only in Postgres
-- (no table rewrite), so this is instant even on the ~837k-row catalog.
ALTER TABLE cc_campaign_catalog
  ADD COLUMN IF NOT EXISTS priced_v2 boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
