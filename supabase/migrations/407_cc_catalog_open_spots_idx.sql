-- 407: Brand campaigns list, with "Has open spots" on (the default), timed out.
--
-- The list asks for live campaigns with open spots, highest commission first,
-- 1,000 at a time. No index matched that order among campaigns with spots, so
-- Postgres read and sorted every live row first, and on a catalogue of about
-- 900,000 rows that ran past the statement timeout ("canceling statement due
-- to statement timeout"). Migration 403 set available_slot to 0 on many rows,
-- which left fewer open ones near the top and made it worse.
--
-- A partial index over campaigns with open spots, in commission order, lets
-- the query walk the top of that list and stop at 1,000.
--
-- Safe to run twice.

set statement_timeout = 0;

create index if not exists cc_catalog_open_commission_idx
  on public.cc_campaign_catalog (commission_pct desc nulls last)
  where available_slot > 0;

analyze public.cc_campaign_catalog;
