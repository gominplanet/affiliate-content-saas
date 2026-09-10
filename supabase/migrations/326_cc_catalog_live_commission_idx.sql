-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Make the "how many campaigns match" count exact instead of half-wrong.
--
-- CC Campaigns reported its headline with a PLANNER ESTIMATE, on the reasoning
-- that an exact count over 918,748 rows was too expensive to run per keystroke.
-- The estimate turned out to be wrong by about half, twice over:
--
--   shown "About 446,338 live campaigns"   true count 893,644
--   shown "About 2,234 match solar"        true count   4,140
--
-- Half the truth is worse than no number. It reads as a catalogue that failed to
-- import, and it sent us looking for missing campaigns that were there all along.
--
-- Every CC Campaigns query filters on exactly these two columns:
--   where ends_at >= current_date and commission_pct > 0
-- With both of them in one index, that count is an index-only scan over the
-- index rather than a read of the table, which is what makes an exact count
-- affordable on every search.
--
-- ends_at leads because it is the range predicate and the same order every
-- listing sorts and filters by. commission_pct follows so the second predicate
-- is answered from the index too, with no heap fetch.
--
-- Index-only scans depend on the visibility map, so the ANALYZE below is
-- followed by nothing special: autovacuum maintains it. A freshly merged
-- catalogue may read from the heap for a short while and get faster on its own.
--
-- Additive. No data changes. Safe to run twice.
--
-- Expect a couple of minutes on 918k rows, and Browse reads will block while it
-- builds, so run it when the site is quiet. Written without CONCURRENTLY
-- because the Supabase SQL editor runs statements inside a transaction and
-- CONCURRENTLY cannot.

create index if not exists cc_catalog_live_commission_idx
  on public.cc_campaign_catalog (ends_at, commission_pct);

-- Let the planner see it immediately rather than waiting for autovacuum.
analyze public.cc_campaign_catalog;
