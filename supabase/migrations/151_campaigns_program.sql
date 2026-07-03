-- Migration 151: distinguish EPC vs Affiliate+ Creator Connections programs
--
-- Amazon runs TWO different Creator Connections payment models, and they were
-- being collapsed into one field:
--   • EPC  — pay-per-CLICK. "Estimated EPC: Up to $0.38". Dollars, in `epc`.
--   • Affiliate+ — extra COMMISSION on each actual SALE. "10% commission". A
--     percent, which was wrongly being stuffed into the dollar `epc` field.
--
-- `program` tags which model a row is (existing rows are all EPC — that's what
-- the legacy EPC Scout scanned). `commission_pct` holds the Affiliate+ rate as a
-- real number so it's never confused with a dollar EPC.

alter table public.campaigns
  add column if not exists program text not null default 'epc'
    check (program in ('epc', 'affiliate_plus'));

alter table public.campaigns
  add column if not exists commission_pct numeric;

-- Existing rows predate SCOUT's Affiliate+ push and came from EPC Scout, so the
-- 'epc' default is already correct; no backfill needed.
