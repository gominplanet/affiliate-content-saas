-- 350 — the summary counts a video still being resolved as unfinished.
--
-- Migration 349's function treated "pending" as the only unfinished state. The
-- back catalogue now has a second one: a video whose product link is a geni.us
-- or amzn.to short link is marked 'resolving' while the scanner follows the
-- redirect to find the ASIN.
--
-- WITHOUT THIS the progress line counts those as checked. A creator with a
-- short link on every video would watch "checked 1000 of 1000" while the
-- scanner was still working through the lot, which is the same lie as a
-- finished-looking bar over a job that has not started.
--
-- Safe to run more than once.

create or replace function public.catalogue_run_summary(p_run uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    -- Distinct VIDEOS. Counting rows would report a five-market run as five
    -- times the size of the creator's channel.
    'videos', (
      select count(distinct video_id) from public.catalogue_run_items where run_id = p_run
    ),
    -- Unfinished, which is not the same as 'pending'. A video waiting on a
    -- redirect has had no answer either.
    'videosPending', (
      select count(distinct video_id) from public.catalogue_run_items
       where run_id = p_run and state in ('pending', 'resolving')
    ),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('domain', d, 'state', s, 'reason', r, 'n', n))
        from (
          select domain as d, state as s, reason as r, count(*) as n
            from public.catalogue_run_items
           where run_id = p_run
           group by domain, state, reason
        ) t
    ), '[]'::jsonb),
    'cardVideoIds', coalesce((
      select jsonb_agg(v)
        from (
          select distinct video_id as v
            from public.catalogue_run_items
           where run_id = p_run
             and domain <> ''
             and state in ('eligible', 'paid', 'queued', 'delivered', 'failed')
           order by video_id
           limit 250
        ) c
    ), '[]'::jsonb)
  )
$$;

comment on function public.catalogue_run_summary(uuid) is
  'Counts for one back-catalogue run, computed in Postgres. The route must not count rows it fetched: PostgREST caps a response at 1000 and a multi-market run is several thousand rows, which turned a page length into a total on screen. Unfinished means pending or resolving, because a video waiting on a redirect has had no answer either.';
