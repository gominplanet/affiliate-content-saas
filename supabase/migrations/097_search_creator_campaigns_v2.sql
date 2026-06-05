-- 097_search_creator_campaigns_v2.sql
-- ─────────────────────────────────────────────────────────────────────────
-- The 084-era search_creator_campaigns RPC started crossing Supabase's
-- 8-second statement timeout once the catalog crossed ~500K rows. The
-- original plan was:
--   1. Filter by trigram + commission + days + budget
--   2. DISTINCT ON (asin) ORDER BY asin, commission desc
--   3. Wrap with an outer ORDER BY commission desc + LIMIT
-- The DISTINCT ON forced Postgres to sort the ENTIRE filtered result by
-- asin before applying the outer limit — at 631K rows with a popular
-- keyword like "solar" matching thousands, that sort alone was eating
-- the whole 8-second budget.
--
-- New plan (this migration):
--   1. Filter + sort by commission DESC, LIMIT to limit*5 (overfetch
--      window — enough headroom to absorb intra-ASIN duplicates).
--   2. Dedupe THAT smaller set by asin.
--   3. Re-sort the deduped set by commission DESC, take limit.
-- Plus: SET LOCAL statement_timeout = '20s' inside the function so it's
-- given headroom over the connection-default 8s if a particularly hot
-- keyword needs more breathing room. Still bounded — never a runaway.
--
-- Also adds one more index that the old plan didn't lean on but the new
-- one does: a partial b-tree on (commission desc) WHERE has_budget_and_slots,
-- so the most-common path (need-budget=true filter, sort by commission)
-- can read the index in order and skip any heap scan until the limit
-- is satisfied. The previous full-table commission index forced the
-- planner to filter post-sort, which was the second-biggest hot spot.

create index if not exists creator_connections_catalog_active_commission_idx
  on public.creator_connections_catalog (commission desc nulls last)
  where has_budget_and_slots = true;

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
-- Attach the longer statement budget at the function level rather than
-- via SET LOCAL inside the body — Postgres rejects SET LOCAL inside
-- non-VOLATILE functions ("SET is not allowed in a non-volatile
-- function"). The function-attribute form has identical effect: this
-- timeout overrides the connection default for the duration of the
-- call and only the call, then reverts.
set statement_timeout to '20s'
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 500), 1);
  -- 5x overfetch so the dedup pass has enough rows to choose the
  -- highest-commission instance per ASIN even when Amazon's export
  -- duplicates a product across many campaigns. Capped to keep the
  -- inner sort cheap.
  v_overfetch integer := least(greatest(v_limit * 5, 500), 5000);
begin
  if p_keyword is null or p_keyword = '' then
    return query
    with candidates as (
      select c.asin, c.campaign_id, c.campaign_name, c.brand,
             c.commission, c.ends_at, c.days_left
        from public.creator_connections_catalog c
       where c.commission >= coalesce(p_min_commission, 0)
         and (c.days_left is null or c.days_left >= coalesce(p_min_days, 0))
         and (not coalesce(p_need_budget, false) or c.has_budget_and_slots = true)
       order by c.commission desc nulls last
       limit v_overfetch
    ),
    deduped as (
      select distinct on (c.asin) c.asin, c.campaign_id, c.campaign_name,
             c.brand, c.commission, c.ends_at, c.days_left
        from candidates c
       order by c.asin, c.commission desc nulls last
    )
    select d.asin, d.campaign_id, d.campaign_name, d.brand,
           d.commission, d.ends_at, d.days_left
      from deduped d
     order by d.commission desc nulls last
     limit v_limit;
  else
    return query
    with candidates as (
      select c.asin, c.campaign_id, c.campaign_name, c.brand,
             c.commission, c.ends_at, c.days_left
        from public.creator_connections_catalog c
       where (c.campaign_name ilike '%' || p_keyword || '%'
              or c.brand ilike '%' || p_keyword || '%')
         and c.commission >= coalesce(p_min_commission, 0)
         and (c.days_left is null or c.days_left >= coalesce(p_min_days, 0))
         and (not coalesce(p_need_budget, false) or c.has_budget_and_slots = true)
       order by c.commission desc nulls last
       limit v_overfetch
    ),
    deduped as (
      select distinct on (c.asin) c.asin, c.campaign_id, c.campaign_name,
             c.brand, c.commission, c.ends_at, c.days_left
        from candidates c
       order by c.asin, c.commission desc nulls last
    )
    select d.asin, d.campaign_id, d.campaign_name, d.brand,
           d.commission, d.ends_at, d.days_left
      from deduped d
     order by d.commission desc nulls last
     limit v_limit;
  end if;
end;
$$;
grant execute on function public.search_creator_campaigns(text, numeric, integer, boolean, integer) to authenticated;
