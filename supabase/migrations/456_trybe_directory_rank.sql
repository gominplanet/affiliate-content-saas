-- 456: Find brands ranks real signals, not brand ids (Labs).
--
-- trybe_directory_search (418) broke ties by trybe_score, then brand_id. MVP's
-- copy of TRYBE has no trybe_score for any brand, so a broad search handed
-- back its first 1,000 brands in id order: an arbitrary slice of about 7,400,
-- and "Newest" never saw the newest (TRYBE review, 2026-10-24).
--
-- trybe_directory_rank breaks ties by what MVP does know: brands creators
-- rated on TRYBE first, then how often a brand is in TRYBE's Top 100, then
-- its Meta ads, then the newest. "newest" orders by TRYBE's join date, then
-- by when MVP first saw the brand. Brands TRYBE no longer lists (p_since)
-- are left out before the limit, so the limit is never spent on them.
-- Returns up to 3,000; the server pages it in thousands.
--
-- Also trybe_star, below: one star saved in one statement.
--
-- Server only (security definer, no grant to signed-in users). The old
-- function stays, so a server that has not been updated keeps working.
-- Safe to run twice.

create or replace function public.trybe_directory_rank(p_words text[], p_user uuid, p_limit integer, p_sort text, p_since timestamptz)
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
    and (p_since is null or d.last_seen_at >= p_since)
    and not exists (
      select 1 from public.trybe_brands b where b.user_id = p_user and b.brand_id = d.brand_id)
  order by
    hits desc,
    case when p_sort = 'newest' then coalesce(d.raw->>'joinedAt', d.raw->>'joinedTrybeAt', d.raw->>'onboardedAt', d.raw->>'launchedAt', d.raw->>'createdAt', d.raw->>'created_at', d.raw->>'joined_at') end desc nulls last,
    case when p_sort = 'newest' then d.first_seen_at end desc nulls last,
    (d.raw->>'reviewRating') is not null desc,
    d.top100_hits desc nulls last,
    d.meta_ads desc nulls last,
    d.first_seen_at desc nulls last,
    d.brand_id
  limit greatest(1, least(coalesce(p_limit, 400), 3000))
$$;

revoke all on function public.trybe_directory_rank(text[], uuid, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.trybe_directory_rank(text[], uuid, integer, text, timestamptz) to service_role;

-- A star, added or taken off in one statement (TRYBE review, 2026-10-24: the
-- page read the starred list, changed it and wrote it back whole, so two quick
-- stars could lose one while the page showed both). Server only.
create or replace function public.trybe_star(p_user uuid, p_brand text, p_on boolean)
returns text[]
language sql
security definer
set search_path = public
as $$
  insert into public.trybe_outreach_settings as s (user_id, starred, updated_at)
  values (p_user, case when p_on then array[p_brand] else '{}'::text[] end, now())
  on conflict (user_id) do update set
    starred = case
      when p_on and p_brand = any(s.starred) then s.starred
      when p_on then s.starred || p_brand
      else array_remove(s.starred, p_brand)
    end,
    updated_at = now()
  returning starred
$$;

revoke all on function public.trybe_star(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.trybe_star(uuid, text, boolean) to service_role;

notify pgrst, 'reload schema';
