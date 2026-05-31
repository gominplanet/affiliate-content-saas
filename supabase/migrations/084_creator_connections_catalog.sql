-- 084_creator_connections_catalog.sql
-- Shared Amazon Creator Connections catalog. Admin uploads the weekly
-- export .zip; this table holds the parsed result. All authenticated
-- users can read; only admin (via service-role) can write.
--
-- Replaces the per-user client-side .zip upload on the Creator Campaigns
-- page — users now query a centralized catalog the admin refreshes weekly,
-- so they don't each have to know where the Amazon export lives.

create table if not exists public.creator_connections_catalog (
  id uuid primary key default gen_random_uuid(),
  asin text not null,
  campaign_id text not null,
  campaign_name text,
  brand text,
  commission numeric,
  ends_at date,
  days_left integer,
  budget_remain numeric default 0,
  slots_available numeric default 0,
  has_budget_and_slots boolean default false,
  imported_at timestamptz default now()
);
-- Note: we previously had a `raw_row jsonb` column here to preserve every
-- Amazon CSV column. Removed because (a) it was never read by any code
-- path and (b) it bloated the table by 1-2 GB on a 470k-row weekly export.
-- All fields the search route actually uses are extracted into typed
-- columns above.

create unique index if not exists creator_connections_catalog_unq
  on public.creator_connections_catalog (campaign_id, asin);
create index if not exists creator_connections_catalog_commission_idx
  on public.creator_connections_catalog (commission desc);
create index if not exists creator_connections_catalog_days_idx
  on public.creator_connections_catalog (days_left);
create index if not exists creator_connections_catalog_brand_idx
  on public.creator_connections_catalog (lower(brand));
create index if not exists creator_connections_catalog_budget_idx
  on public.creator_connections_catalog (has_budget_and_slots);
create index if not exists creator_connections_catalog_imported_idx
  on public.creator_connections_catalog (imported_at desc);
-- pg_trgm GIN indexes so the user-facing keyword search (ILIKE) can use
-- an index instead of full-scanning 470k rows. Without these the search
-- route times out on any non-trivial dataset. Trigram indexes are faster
-- to maintain on bulk insert than tsvector GIN, so worth the upfront cost.
create extension if not exists pg_trgm;
create index if not exists creator_connections_catalog_name_trgm_idx
  on public.creator_connections_catalog
  using gin (campaign_name gin_trgm_ops);
create index if not exists creator_connections_catalog_brand_trgm_idx
  on public.creator_connections_catalog
  using gin (brand gin_trgm_ops);

-- Search RPC function. Centralizes the catalog search logic in Postgres
-- so the query planner sees one deterministic query (instead of whatever
-- PostgREST cobbles together from chained .or() calls) and can pick the
-- right indexes consistently.
--
-- Used by /api/campaigns/catalog/search via supabase.rpc().
-- plpgsql with IF/ELSE so the planner can build TWO separate query plans —
-- one for "keyword present" (starts with the trigram index) and one for
-- "no keyword" (starts with the commission b-tree). DISTINCT ON dedupes
-- by ASIN inside the function so the route doesn't have to overfetch
-- (overfetch=2000 was crossing the statement timeout).
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
as $$
begin
  if p_keyword is null or p_keyword = '' then
    return query
    select d.asin, d.campaign_id, d.campaign_name, d.brand, d.commission, d.ends_at, d.days_left
      from (
        select distinct on (c.asin) c.asin, c.campaign_id, c.campaign_name, c.brand,
               c.commission, c.ends_at, c.days_left
          from public.creator_connections_catalog c
         where c.commission >= coalesce(p_min_commission, 0)
           and (c.days_left is null or c.days_left >= coalesce(p_min_days, 0))
           and (not coalesce(p_need_budget, false) or c.has_budget_and_slots = true)
         order by c.asin, c.commission desc nulls last
      ) d
     order by d.commission desc nulls last
     limit greatest(coalesce(p_limit, 500), 1);
  else
    return query
    select d.asin, d.campaign_id, d.campaign_name, d.brand, d.commission, d.ends_at, d.days_left
      from (
        select distinct on (c.asin) c.asin, c.campaign_id, c.campaign_name, c.brand,
               c.commission, c.ends_at, c.days_left
          from public.creator_connections_catalog c
         where (c.campaign_name ilike '%' || p_keyword || '%' or c.brand ilike '%' || p_keyword || '%')
           and c.commission >= coalesce(p_min_commission, 0)
           and (c.days_left is null or c.days_left >= coalesce(p_min_days, 0))
           and (not coalesce(p_need_budget, false) or c.has_budget_and_slots = true)
         order by c.asin, c.commission desc nulls last
      ) d
     order by d.commission desc nulls last
     limit greatest(coalesce(p_limit, 500), 1);
  end if;
end;
$$;
grant execute on function public.search_creator_campaigns(text, numeric, integer, boolean, integer) to authenticated;

alter table public.creator_connections_catalog enable row level security;
create policy "Authenticated read" on public.creator_connections_catalog
  for select using (auth.uid() is not null);
-- No INSERT/UPDATE/DELETE policies: those go through service-role only,
-- gated by tier='admin' check in /api/admin/creator-campaigns/import.
