-- 098_creator_campaigns_canonical.sql
-- ─────────────────────────────────────────────────────────────────────────
-- The catalog stores EVERY (campaign_id, asin) pair Amazon ships — the
-- same product listed under many campaigns. With 631K rows on this
-- week's export, every search has to dedup-by-ASIN at query time, and
-- the OR-clause ILIKE on campaign_name + brand can't lean on the
-- existing indexes hard enough. Result: timeouts.
--
-- Fix: precompute the dedup ONCE at import time. Each ASIN gets exactly
-- one row marked `is_canonical = true` (the highest-commission instance).
-- The search then runs against only those rows — typically 30-50K total
-- — and the dedup work in the RPC disappears entirely.
--
-- This migration:
--   1. Adds `is_canonical boolean default false` to the catalog.
--   2. Adds an RPC `recompute_canonical_creator_campaigns()` the
--      import flow calls after the final batch. Two UPDATEs: reset
--      everything to false, then set the per-ASIN winner to true.
--   3. Adds a tight composite index for the canonical search path:
--      partial index on (commission DESC NULLS LAST) WHERE is_canonical.
--   4. Backfills is_canonical for whatever's currently in the table so
--      the next search works without waiting for the next weekly import.
--   5. Rewrites the search RPC to drop the DISTINCT ON and just filter
--      WHERE is_canonical. Same return shape; much smaller working set.

-- ── 1. Column ─────────────────────────────────────────────────────────────
alter table public.creator_connections_catalog
  add column if not exists is_canonical boolean default false;

-- ── 2. Recompute RPC ──────────────────────────────────────────────────────
create or replace function public.recompute_canonical_creator_campaigns()
returns integer
language plpgsql
volatile
set statement_timeout to '120s'
as $$
declare
  v_canonical_count integer;
begin
  -- Reset first so any ASIN that lost its top-commission row in this
  -- import doesn't keep an old canonical row flagged. Cheap because
  -- the table has only one column being touched + has_budget index.
  update public.creator_connections_catalog
     set is_canonical = false
   where is_canonical = true;

  -- For each ASIN, mark the highest-commission row as canonical. We
  -- restrict to has_budget_and_slots = true since the search filter
  -- always honors that — if Amazon ever ships a campaign that's
  -- "actionable but no slots", it stays unflagged and out of search
  -- results. (Today the import-batch route filters those out at write
  -- time so this WHERE is a belt-and-suspenders guard.)
  with winners as (
    select distinct on (asin) id
      from public.creator_connections_catalog
     where has_budget_and_slots = true
     order by asin, commission desc nulls last
  )
  update public.creator_connections_catalog c
     set is_canonical = true
    from winners w
   where c.id = w.id;

  select count(*) into v_canonical_count
    from public.creator_connections_catalog
   where is_canonical = true;
  return v_canonical_count;
end;
$$;
grant execute on function public.recompute_canonical_creator_campaigns() to authenticated;

-- ── 3. Search-path index ──────────────────────────────────────────────────
-- Partial b-tree on (commission desc) WHERE is_canonical = true.
-- Roughly 30-50K rows on a real-world catalog, so the search can scan
-- this in commission order, filter by keyword + days, and stop at the
-- requested limit without ever touching the bulk of the table.
create index if not exists creator_connections_catalog_canonical_idx
  on public.creator_connections_catalog (commission desc nulls last)
  where is_canonical = true;

-- ── 4. Backfill so today's catalog is searchable immediately ──────────────
select public.recompute_canonical_creator_campaigns();

-- ── 5. Rewrite search RPC: no more DISTINCT ON ────────────────────────────
create or replace function public.search_creator_campaigns(
  p_keyword text,
  p_min_commission numeric,
  p_min_days integer,
  p_need_budget boolean,
  p_limit integer
)
returns table (
  asin text,
  campaign_id text,
  campaign_name text,
  brand text,
  commission numeric,
  ends_at date,
  days_left integer
)
language plpgsql
stable
set statement_timeout to '20s'
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 500), 1);
begin
  -- The catalog now stores one canonical row per ASIN, so the search
  -- doesn't have to dedup. Pure filter + sort + limit on a partial
  -- index. p_need_budget is honored implicitly — only has_budget rows
  -- ever become canonical (see recompute_canonical above) — but we
  -- leave the param in the signature so old API callers still work.
  if p_keyword is null or p_keyword = '' then
    return query
    select c.asin, c.campaign_id, c.campaign_name, c.brand,
           c.commission, c.ends_at, c.days_left
      from public.creator_connections_catalog c
     where c.is_canonical = true
       and c.commission >= coalesce(p_min_commission, 0)
       and (c.days_left is null or c.days_left >= coalesce(p_min_days, 0))
     order by c.commission desc nulls last
     limit v_limit;
  else
    return query
    select c.asin, c.campaign_id, c.campaign_name, c.brand,
           c.commission, c.ends_at, c.days_left
      from public.creator_connections_catalog c
     where c.is_canonical = true
       and (c.campaign_name ilike '%' || p_keyword || '%'
            or c.brand ilike '%' || p_keyword || '%')
       and c.commission >= coalesce(p_min_commission, 0)
       and (c.days_left is null or c.days_left >= coalesce(p_min_days, 0))
     order by c.commission desc nulls last
     limit v_limit;
  end if;
end;
$$;
grant execute on function public.search_creator_campaigns(text, numeric, integer, boolean, integer) to authenticated;
