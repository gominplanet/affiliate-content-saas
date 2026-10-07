-- 418: TRYBE directory search in the database (Labs).
--
-- The niche search ran over MVP's copy of every TRYBE brand (about 6,000) by
-- pulling the matching rows, website text included, into the server, a
-- thousand at a time. A broad niche matched thousands of rows: tens of MB per
-- search. Here the database counts how many of the creator's words each brand
-- matches (TRYBE's own text and its website's), leaves out brands already on
-- that creator's list, and returns only the best ids. MVP then ranks those
-- few hundred finely (lib/trybe-directory nicheScore).
--
-- Server only (security definer, no grant to signed-in users). Safe to run
-- twice.

create or replace function public.trybe_directory_search(p_words text[], p_user uuid, p_limit integer)
returns table (brand_id text, hits integer)
language sql
stable
security definer
set search_path = public
as $$
  select d.brand_id,
    (select count(*) from unnest(p_words) w
      where d.search_text ilike '%' || w || '%' or d.site_text ilike '%' || w || '%')::integer as hits
  from public.trybe_directory d
  where (coalesce(cardinality(p_words), 0) = 0 or exists (
      select 1 from unnest(p_words) w
      where d.search_text ilike '%' || w || '%' or d.site_text ilike '%' || w || '%'))
    and not exists (
      select 1 from public.trybe_brands b where b.user_id = p_user and b.brand_id = d.brand_id)
  order by hits desc, d.trybe_score desc nulls last, d.brand_id
  limit greatest(1, least(coalesce(p_limit, 300), 1000))
$$;

revoke all on function public.trybe_directory_search(text[], uuid, integer) from public, anon, authenticated;
grant execute on function public.trybe_directory_search(text[], uuid, integer) to service_role;

notify pgrst, 'reload schema';
