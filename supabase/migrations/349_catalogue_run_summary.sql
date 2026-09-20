-- 349 — count a back-catalogue run in Postgres, not in a page of rows.
--
-- THE BUG THIS FIXES, seen on a real run. The screen said "Checking your
-- videos… 472 of 583" for a run over 1000 videos. 583 was not the size of
-- anything: the status route fetched the run's items and counted them, and
-- PostgREST caps a response at 1000 rows. A 1000-video run across five markets
-- is over 4000 rows, so the route was counting the first page and presenting it
-- as the total.
--
-- That is precisely the failure the whole feature exists to avoid. It is the
-- cap-presented-as-a-total bug for the third time in this feature: first the
-- 1000-video enumeration limit, then the card list, now the counts themselves.
-- A number on this screen has to come from a count, never from the length of
-- whatever happened to be returned.
--
-- SECURITY INVOKER, so the caller's RLS policy still decides which rows they
-- can see. A security-definer function here would hand any signed-in user the
-- counts for anybody's run.
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
    'videosPending', (
      select count(distinct video_id) from public.catalogue_run_items
       where run_id = p_run and state = 'pending'
    ),
    -- One row per (marketplace, verdict, reason). The reason is carried so the
    -- screen can name what happened rather than only how often.
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('domain', d, 'state', s, 'reason', r, 'n', n))
        from (
          select domain as d, state as s, reason as r, count(*) as n
            from public.catalogue_run_items
           where run_id = p_run
           group by domain, state, reason
        ) t
    ), '[]'::jsonb),
    -- The videos worth drawing a card for: they have at least one marketplace
    -- that can actually be sent. Bounded here rather than in the caller, so the
    -- row fetch that follows is bounded too.
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
  'Counts for one back-catalogue run, computed in Postgres. The route must not count rows it fetched: PostgREST caps a response at 1000 and a multi-market run is several thousand rows, which turned a page length into a total on screen.';
