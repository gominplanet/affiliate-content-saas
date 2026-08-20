-- 268 — Storefront earnings: full-year CSV import + Creator Connections.
--
-- The SCOUT scraper only reads one report period at a time and only the regular
-- Commissions table, so a creator's storefront in MVP showed a single month and
-- missed Creator Connections earnings entirely (which for some creators is the
-- majority of income). We're adding a "Download Reports" CSV import so a creator
-- can drop in Amazon's full-year export in one file, for BOTH report types.
--
-- Two schema changes make that work:
--   1. period_type gains 'ytd' — a single row per product for a whole exported
--      date range (Amazon's downloaded report is aggregated, not per-month).
--   2. `source` joins the unique key. A product can earn from BOTH regular
--      commissions AND a Creator Connections campaign in the same range; without
--      source in the key those two rows would collide and one would overwrite
--      the other. With it, both are kept and the storefront sums them.
--
-- Idempotent. Safe to run more than once.

-- 1. Allow the 'ytd' period granularity.
alter table public.storefront_earnings
  drop constraint if exists storefront_earnings_period_type_check;
alter table public.storefront_earnings
  add constraint storefront_earnings_period_type_check
  check (period_type in ('weekly', 'monthly', 'ytd'));

-- 2. Add source to the uniqueness key so commissions + CC rows coexist.
--    Drop the old auto-named unique constraint (from the inline `unique(...)`),
--    then add the wider one under a stable name we control.
alter table public.storefront_earnings
  drop constraint if exists storefront_earnings_user_id_asin_period_type_period_start_key;
alter table public.storefront_earnings
  drop constraint if exists storefront_earnings_uniq;
alter table public.storefront_earnings
  add constraint storefront_earnings_uniq
  unique (user_id, asin, period_type, period_start, source);

notify pgrst, 'reload schema';
