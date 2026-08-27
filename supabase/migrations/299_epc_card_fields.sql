-- 299 — richer product facts for EPC cards (from Amazon's spcc/search API).
--
-- The API loader (SCOUT "Load all from Amazon") gets each opportunity's review
-- count, stock availability, and Amazon category straight from Amazon's own
-- response. Store them on both the per-user library and the shared catalog so the
-- cards can show richer info (social proof + stock + category) without a Keepa
-- lookup. Idempotent.

alter table public.epc_products add column if not exists review_count integer;
alter table public.epc_products add column if not exists availability text;
alter table public.epc_products add column if not exists category     text;

alter table public.epc_catalog  add column if not exists review_count integer;
alter table public.epc_catalog  add column if not exists availability text;
alter table public.epc_catalog  add column if not exists category     text;

notify pgrst, 'reload schema';
