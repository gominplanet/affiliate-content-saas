-- 099b_search_rpc_self_heal.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Hot-fix for "column c.is_canonical does not exist" on Search catalog.
--
-- Migration 099 (price column) recreated search_creator_campaigns with a
-- body that references `c.is_canonical`. That column was supposed to
-- exist thanks to migration 098, but in practice 098 might have been
-- run partially or in a different env. Result: the search RPC fails
-- at runtime even though both migrations *technically* ran.
--
-- This migration is idempotent + order-independent: it ensures every
-- column the search RPC depends on actually exists, backfills
-- is_canonical if it had to be added, and replaces the search RPC
-- body again so it's locked to a known-good version. Safe to run any
-- number of times.

-- ── 1. Columns the search depends on ─────────────────────────────────────
alter table public.creator_connections_catalog
  add column if not exists is_canonical boolean default false,
  add column if not exists price        numeric;

alter table public.campaigns
  add column if not exists product_price numeric;

-- ── 2. Helper + index ────────────────────────────────────────────────────
-- Both safe to recreate; CREATE OR REPLACE FUNCTION and CREATE INDEX IF
-- NOT EXISTS are no-ops when already present at the right definition.
create or replace function public.recompute_canonical_creator_campaigns()
returns integer
language plpgsql
volatile
set statement_timeout to '120s'
as $$
declare v_canonical_count integer;
begin
  update public.creator_connections_catalog
     set is_canonical = false
   where is_canonical = true;

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

create index if not exists creator_connections_catalog_canonical_idx
  on public.creator_connections_catalog (commission desc nulls last)
  where is_canonical = true;

-- ── 3. Backfill is_canonical if it was just added (or had drifted) ───────
-- The function exits early when there's nothing to do, so re-running
-- this whole migration on a healthy DB is cheap (a few ms).
select public.recompute_canonical_creator_campaigns();

-- ── 4. Lock the search RPC to the price-aware definition ─────────────────
drop function if exists public.search_creator_campaigns(
  text, numeric, integer, boolean, integer
);
drop function if exists public.search_creator_campaigns(
  text, numeric, integer, boolean, integer, numeric, numeric
);

create or replace function public.search_creator_campaigns(
  p_keyword text,
  p_min_commission numeric,
  p_min_days integer,
  p_need_budget boolean,
  p_limit integer,
  p_min_price numeric default null,
  p_max_price numeric default null
)
returns table (
  asin text,
  campaign_id text,
  campaign_name text,
  brand text,
  commission numeric,
  ends_at date,
  days_left integer,
  price numeric
)
language plpgsql
stable
set statement_timeout to '20s'
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 500), 1);
begin
  if p_keyword is null or p_keyword = '' then
    return query
    select c.asin, c.campaign_id, c.campaign_name, c.brand,
           c.commission, c.ends_at, c.days_left, c.price
      from public.creator_connections_catalog c
     where c.is_canonical = true
       and c.commission >= coalesce(p_min_commission, 0)
       and (c.days_left is null or c.days_left >= coalesce(p_min_days, 0))
       and (p_min_price is null or (c.price is not null and c.price >= p_min_price))
       and (p_max_price is null or c.price is null or c.price <= p_max_price)
     order by c.commission desc nulls last
     limit v_limit;
  else
    return query
    select c.asin, c.campaign_id, c.campaign_name, c.brand,
           c.commission, c.ends_at, c.days_left, c.price
      from public.creator_connections_catalog c
     where c.is_canonical = true
       and (c.campaign_name ilike '%' || p_keyword || '%'
            or c.brand ilike '%' || p_keyword || '%')
       and c.commission >= coalesce(p_min_commission, 0)
       and (c.days_left is null or c.days_left >= coalesce(p_min_days, 0))
       and (p_min_price is null or (c.price is not null and c.price >= p_min_price))
       and (p_max_price is null or c.price is null or c.price <= p_max_price)
     order by c.commission desc nulls last
     limit v_limit;
  end if;
end;
$$;
grant execute on function public.search_creator_campaigns(text, numeric, integer, boolean, integer, numeric, numeric) to authenticated;
