-- 099_creator_campaigns_price.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Capture each campaign's product price end-to-end so the user can:
--   - see it on every queue row + every search result
--   - filter searches by min/max price ("solar lights under $50")
--
-- Three schema touches + a new RPC signature:
--   1. creator_connections_catalog.price (numeric, nullable)
--      Source: the Amazon Creator Connections weekly export's price
--      column. Parsed at import-batch time client-side. Nullable because
--      Amazon occasionally ships ranges or blanks.
--   2. campaigns.product_price (numeric, nullable)
--      The price snapshot at QUEUE time. We don't re-read it from the
--      catalog later because (a) the row could get repriced between
--      queue + publish, and (b) the user saw a specific number when
--      they queued — keep the receipt.
--   3. search_creator_campaigns RPC gets two new params (p_min_price,
--      p_max_price, both nullable) and returns the price column.
--
-- No new index — price filtering is a range scan on the already-cheap
-- canonical subset (~30-50K rows). Indexing would buy ~ms at the cost
-- of write speed on every upsert.

-- ── 1. Catalog ────────────────────────────────────────────────────────────
alter table public.creator_connections_catalog
  add column if not exists price numeric;

-- ── 2. Campaigns queue ────────────────────────────────────────────────────
alter table public.campaigns
  add column if not exists product_price numeric;

-- ── 3. Search RPC — drop the old signature first since we're adding
--    parameters (Postgres treats arg count as part of the identity). ─────
drop function if exists public.search_creator_campaigns(
  text, numeric, integer, boolean, integer
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
       -- Price filters: null bounds = "no limit on that side". Rows with
       -- null price pass the upper bound (we can't prove they're too
       -- expensive) but FAIL the lower bound (we can't prove they're
       -- expensive enough) — so users who set a minimum still see only
       -- rows where we know the price.
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
