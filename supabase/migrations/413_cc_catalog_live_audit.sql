-- 413: who last changed a campaign's live numbers, and when.
--
-- Seb, 2026-10-07: a member's Creator Connections scan may only refresh the
-- live numbers (spots, budget, rating, reviews) of campaigns already in the
-- shared catalogue. Each change is signed with the member and the time, which
-- gives the daily cap per account something to count and makes one member's
-- bad writes easy to find and undo.
--
-- Safe to run twice.

alter table public.cc_campaign_catalog add column if not exists last_live_by uuid;
alter table public.cc_campaign_catalog add column if not exists last_live_at timestamptz;

create index if not exists cc_catalog_last_live_idx
  on public.cc_campaign_catalog (last_live_by, last_live_at desc)
  where last_live_by is not null;

notify pgrst, 'reload schema';
