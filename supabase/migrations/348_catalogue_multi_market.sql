-- 348 — a back-catalogue run covers several marketplaces at once.
--
-- WHY. One yt-dlp track-list lookup returns EVERY language YouTube has dubbed a
-- video into. Running the scan once for German and again for French repeats the
-- same call for an answer the first one already contained, and the proxy cost
-- and the bot-wall risk are per call. So a run now holds the markets the creator
-- picked, each video is looked at once, and every market's verdict is written
-- from that single answer.
--
-- The item rows go from one per video to one per (video, market). The exception
-- is a verdict about the VIDEO rather than about a marketplace: no product
-- attached, or not on YouTube at all. Those are stored on a row with domain ''
-- so a five-market run reports them once instead of five times.
--
-- Safe to run more than once.

alter table public.catalogue_runs
  add column if not exists domains text[];

-- Existing single-market runs keep working: their one domain becomes the list.
update public.catalogue_runs
   set domains = array[domain]
 where domains is null and domain is not null;

alter table public.catalogue_run_items
  add column if not exists domain text;

-- The ASIN this item will be delivered against, resolved at enumeration time
-- from youtube_videos.asin or from the product_url, the same way
-- /api/global-sync/start resolves it.
alter table public.catalogue_run_items
  add column if not exists asin text;

-- Rows written before this migration belong to their run's single market.
update public.catalogue_run_items i
   set domain = r.domain
  from public.catalogue_runs r
 where r.id = i.run_id
   and i.domain is null
   and i.state <> 'skipped';

-- A verdict about the video itself carries no marketplace.
update public.catalogue_run_items
   set domain = ''
 where domain is null;

alter table public.catalogue_run_items
  alter column domain set default '';

-- One verdict per video per market per run. The old constraint allowed a single
-- row per video, which a multi-market run has to exceed.
--
-- Dropped by SHAPE rather than by name. 347 declared it inline, so its name is
-- whatever Postgres generated, and a `drop constraint if exists` against a
-- guessed name would succeed while leaving the constraint in place, which then
-- rejects the second market of every run.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'catalogue_run_items'
       and con.contype = 'u'
       and (
         select array_agg(att.attname order by att.attname)
           from unnest(con.conkey) k
           join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k
       ) = array['run_id','video_id']
  loop
    execute format('alter table public.catalogue_run_items drop constraint %I', c.conname);
  end loop;
end $$;

drop index if exists catalogue_run_items_one_per_market;
create unique index if not exists catalogue_run_items_one_per_market
  on public.catalogue_run_items (run_id, video_id, domain);

-- The scanner claims pending work across all runs, oldest first.
drop index if exists catalogue_run_items_pending_idx;
create index if not exists catalogue_run_items_pending_idx
  on public.catalogue_run_items (state, created_at)
  where state = 'pending';

create index if not exists catalogue_run_items_run_domain_idx
  on public.catalogue_run_items (run_id, domain, state);

comment on column public.catalogue_run_items.domain is
  'The Amazon marketplace this verdict is about. Empty string means the verdict is about the video itself (no product attached, not on YouTube), which is true for every market and so is stored once.';

comment on column public.catalogue_runs.domains is
  'Every marketplace this run targets. One track-list lookup per video answers all of them, which is why a run is not per market.';
