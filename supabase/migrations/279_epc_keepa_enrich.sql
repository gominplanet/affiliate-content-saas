-- 279 — Keepa enrichment columns on the EPC library.
--
-- The scan reads what Amazon shows on the Sponsored Products card (title, price,
-- EPC, budget, rating). This adds the demand signals a creator actually decides
-- on — monthly sold + sales rank — plus a reliable product image fallback, all
-- filled from one batched Keepa /product call at ingest time (see /api/epc/ingest).
-- enriched_at gates re-enrichment so re-scanning the same ASINs doesn't re-spend
-- Keepa tokens.

alter table public.epc_products
  add column if not exists monthly_sold        int,
  add column if not exists sales_rank          int,
  add column if not exists sales_rank_category text,
  add column if not exists enriched_at         timestamptz;

notify pgrst, 'reload schema';
