-- 352 — count storefront coverage in Postgres, never in a fetched array.
--
-- SUPERSEDED BY 353, which replaces this function to add the `checking` count.
-- Kept as history. Running 352 after 353 would drop that count and make a
-- stalled existence check look like work in progress again, so run them in
-- order and stop at 353.
--
-- The run model's status route counted the rows it had fetched, and PostgREST
-- caps a response at 1000, so a thousand video catalogue across five markets
-- reported "Checking your videos… 472 of 583". 583 was not the size of
-- anything. It is the same bug that had already appeared twice before that, in
-- the video enumeration cap and in the card list.
--
-- So nothing on the coverage screen reads a row to produce a number.
--
-- SECURITY INVOKER, so the caller's RLS policy still decides whose rows they
-- can count. A definer function here would hand any signed-in user the map for
-- anybody else's account.
--
-- Safe to run more than once.

create or replace function public.storefront_coverage_summary(p_user uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    -- Every video on the account, whether or not it has coverage rows yet.
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
    ), '[]'::jsonb)
  )
$$;

comment on function public.storefront_coverage_summary(uuid) is
  'Coverage counts for one creator, computed in Postgres. No screen may count a fetched array: PostgREST caps a response at 1000 rows and a multi-market catalogue is far more than that, which turned a page length into a total on screen three times in this feature''s history.';
