-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Index the CC Browse sorts that had no index at all.
--
-- Browse offers seven sorts over cc_campaign_catalog, which now holds 918,748
-- rows. Three of them were backed by an index and four were not:
--
--   commission   cc_catalog_rank_idx (commission_pct DESC, ends_at)   indexed
--   recentSales  cc_catalog_monthly_sold_idx                          indexed
--   rating       cc_catalog_rating_idx                                indexed
--   endingSoon   ORDER BY ends_at ASC                                 NO INDEX
--   mostRunway   ORDER BY ends_at DESC                                NO INDEX
--   slots        ORDER BY available_slot DESC NULLS LAST              NO INDEX
--   budget       ORDER BY budget_remaining DESC NULLS LAST            NO INDEX
--
-- An unindexed sort on this table is a sequential scan of every row followed by
-- a sort of nearly all of them, because the one filter every Browse query
-- carries (ends_at >= today) removes only 25,104 of 918,748. It is not
-- selective enough to help, so there was nothing to narrow the scan with.
--
-- The NULLS LAST on the two slot/budget indexes matches the ORDER BY in
-- app/api/campaigns/browse/route.ts exactly. That is not decoration: Postgres
-- only walks an index to satisfy an ORDER BY when the index's null ordering
-- matches the query's, and the default for DESC is NULLS FIRST. An index built
-- without it would sit unused while looking, in pg_indexes, like the problem
-- had been fixed.
--
-- ends_at is the second column on each so a page that is both sorted and
-- runway-filtered still reads in index order.
--
-- These are additive. They cost write time on the weekly catalogue merge and
-- disk, and they change no data. Safe to run twice.
--
-- Expect this to take a few minutes on 918k rows. It is written WITHOUT
-- CONCURRENTLY because the Supabase SQL editor runs statements in a transaction
-- and CONCURRENTLY cannot run inside one. Browse reads will block on each index
-- for the duration, so run it when the site is quiet.

create index if not exists cc_catalog_ends_at_idx
  on public.cc_campaign_catalog (ends_at);

create index if not exists cc_catalog_slots_idx
  on public.cc_campaign_catalog (available_slot desc nulls last, ends_at);

create index if not exists cc_catalog_budget_left_idx
  on public.cc_campaign_catalog (budget_remaining desc nulls last, ends_at);

-- Let the planner see the new indexes immediately rather than waiting for the
-- next autovacuum ANALYZE. Without this the first searches after the migration
-- can still choose a sequential scan.
analyze public.cc_campaign_catalog;
