-- Migration 381: which Creator Connections brand is behind each product, in one call.
--
-- Brand recap asked the catalog (~800k campaigns) one product at a time with a
-- LIMIT, and each question took over ten seconds: with a LIMIT, Postgres may
-- read the table from the top expecting to hit a match soon, and for a product
-- that is in no campaign that means reading every row. This function answers
-- for a whole list at once, one index lookup per product, and is told not to
-- read the table from the top.
--
-- Safe to run twice.

create or replace function public.cc_brands_for_asins(p_asins text[])
returns table(asin text, brand_name text, campaign_id text, campaign_name text)
language sql
stable
set enable_seqscan = off
as $$
  select a.asin, c.brand_name, c.campaign_id, c.campaign_name
  from unnest(p_asins) as a(asin)
  cross join lateral (
    select cc.brand_name, cc.campaign_id, cc.campaign_name
    from public.cc_campaign_catalog cc
    where cc.asins @> array[a.asin]
    limit 3
  ) c
$$;

grant execute on function public.cc_brands_for_asins(text[]) to service_role;
