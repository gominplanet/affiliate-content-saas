-- 291 — de-duplicate the per-user EPC library + guarantee it stays deduped.
--
-- epc_products was meant to hold one row per (user_id, asin) — migration 278
-- declared `unique (user_id, asin)`, and every ingest upserts on that key. If that
-- constraint didn't actually land on a database (e.g. the table pre-existed, or a
-- partial migration), upserts fell back to plain inserts and the same product
-- piled up as duplicate rows, inflating the library count. This removes any such
-- duplicates and (re)adds the unique constraint so it can't happen again.
--
-- NOTE: this only removes EXACT duplicates (same user + same ASIN). Different
-- ASINs for size/colour variants of the "same" product are distinct products and
-- are intentionally kept.

-- 1) Collapse duplicate (user_id, asin) rows, keeping the most-recently-scanned
--    one (its enrichment is freshest); ctid breaks any remaining tie.
delete from public.epc_products a
using public.epc_products b
where a.user_id = b.user_id
  and a.asin = b.asin
  and (a.scanned_at, a.ctid) < (b.scanned_at, b.ctid);

-- 2) Ensure a unique constraint on (user_id, asin) exists so future ingests upsert
--    (dedupe) instead of inserting duplicates. Column-order-safe check; no-op when
--    an equivalent unique already exists (e.g. from migration 278 under any name).
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.epc_products'::regclass
      and c.contype = 'u'
      and (
        select array_agg(a.attname order by a.attname)
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
      ) = array['asin', 'user_id']
  ) then
    alter table public.epc_products add constraint epc_products_user_asin_key unique (user_id, asin);
  end if;
end $$;

notify pgrst, 'reload schema';
