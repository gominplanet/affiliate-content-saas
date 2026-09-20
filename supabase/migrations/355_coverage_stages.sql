-- 355 — tell the two waits apart on the coverage board.
--
-- NO DDL. This replaces one function and nothing else, so it is quick to paste
-- and cannot damage anything.
--
-- WHAT IT FIXES. 353 split "waiting on the product check" out of "being
-- prepared", because a Keepa key that expired would otherwise read as steady
-- progress forever. The step AFTER it has exactly the same shape and was left
-- folded in: the track check asks YouTube which languages a video already
-- carries, it needs the ingest service and working cookies, and when either is
-- down it returns nothing and touches no rows. Every cell then sits at
-- 'unknown' with its stock answered, and the board counts it as being prepared.
--
-- So the drain's three waiting stages are now three numbers:
--
--   checking   has an ASIN, no stock answer yet          (needs Keepa)
--   tracking   stock answered, no language answer yet    (needs the ingest service)
--   preparing  answered, in the pipeline being localized and dubbed
--
-- Each one names a different thing that can be broken, which is the point. A
-- single number covering all three can only ever say "something is happening",
-- and that sentence is true whether or not anything is.
--
-- SECURITY INVOKER, so the caller's RLS policy still decides whose rows they
-- can count. A definer function here would hand any signed-in user the map for
-- anybody else's account.
--
-- Safe to run more than once. Supersedes the copies in 352 and 353.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'storefront_coverage' and column_name = 'stock'
  ) then
    raise exception 'storefront_coverage.stock is missing. Run migrations 351 and 353 first, then this one.';
  end if;
end $$;

create or replace function public.storefront_coverage_summary(p_user uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'videos', (
      select count(*) from public.youtube_videos where user_id = p_user
    ),
    -- THE HEADLINE: distinct videos earning in at least one ENABLED market.
    -- Distinct, because counting rows would report a video live in five
    -- countries as five videos and flatter the number fivefold.
    'videosAbroad', (
      select count(distinct c.video_id)
        from public.storefront_coverage c
        join public.storefront_markets m
          on m.user_id = c.user_id and m.domain = c.domain and m.enabled
       where c.user_id = p_user
         and c.state in ('uploaded', 'live')
    ),
    -- One row per (market, state, reason). The reason travels with the count so
    -- the screen can say what is in the way rather than only how much.
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('domain', d, 'state', s, 'reason', r, 'n', n))
        from (
          select domain as d, state as s, reason as r, count(*) as n
            from public.storefront_coverage
           where user_id = p_user
           group by domain, state, reason
        ) t
    ), '[]'::jsonb),
    -- Waiting on the product check. Needs Keepa.
    'checking', coalesce((
      select jsonb_agg(jsonb_build_object('domain', d, 'n', n))
        from (
          select domain as d, count(*) as n
            from public.storefront_coverage
           where user_id = p_user and state = 'unknown' and stock is null
           group by domain
        ) t
    ), '[]'::jsonb),
    -- Waiting on the language check. Needs the ingest service. Counted apart
    -- because it breaks for completely different reasons than the one above,
    -- and one number covering both can only say "something is happening".
    'tracking', coalesce((
      select jsonb_agg(jsonb_build_object('domain', d, 'n', n))
        from (
          select domain as d, count(*) as n
            from public.storefront_coverage
           where user_id = p_user and state = 'unknown' and stock is not null
           group by domain
        ) t
    ), '[]'::jsonb)
  )
$$;

comment on function public.storefront_coverage_summary(uuid) is
  'Coverage counts for one creator, computed in Postgres. No screen may count a fetched array: PostgREST caps a response at 1000 rows, which turned a page length into a total three times in this feature''s history. The three waits are separate numbers (checking needs Keepa, tracking needs the ingest service, preparing is the render pipeline) because each names a different thing that can be broken, and one number covering all three can only say "something is happening" whether or not anything is.';

notify pgrst, 'reload schema';
