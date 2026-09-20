-- 354 — the background grid dubs its own videos, and "ready" means ready.
--
-- WHAT WAS WRONG. /api/global-sync/dub needs a signed-in creator, and the only
-- thing that ever called it was the browser. The catalogue drain has no
-- session, so its path was: create the sync job, let the recovery cron
-- translate the title and description, mark the cell ready. Nothing dubbed.
-- The delivery queue serves a target with no dub by falling back to the master,
-- so Storefront Sync would have uploaded to amazon.fr with a French title, a
-- French description and ENGLISH AUDIO, and the grid would have called it ready
-- the whole time.
--
-- That is the exact failure the Launchpad guard was written to catch, arriving
-- through the one door that guard does not watch.
--
-- TWO CHANGES BEHIND THIS COLUMN.
--
--   The dub lane moved into a library both callers share, and the drain now
--   runs it with the free standard voice. No cloned-voice credit is ever spent
--   in the background, because nobody is present to agree to it.
--
--   A cell that needs a dub no longer reaches 'ready' when its job is created.
--   It stays 'preparing' with the job attached and is promoted only once the
--   audio actually exists. `ready` now means ready.
--
-- dub_attempts exists so a dub that keeps failing stops rather than retrying
-- every minute forever, and so the cell can say how many times it tried instead
-- of sitting silent.
--
-- Safe to run more than once.

do $$
begin
  if to_regclass('public.storefront_coverage') is null then
    raise exception 'storefront_coverage is missing. Run migration 351 first, then 353, then this one.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'storefront_coverage' and column_name = 'stock'
  ) then
    raise exception 'storefront_coverage.stock is missing. Run migration 353 first, then this one.';
  end if;
end $$;

alter table public.storefront_coverage
  add column if not exists dub_attempts integer not null default 0;

comment on column public.storefront_coverage.dub_attempts is
  'How many times the background lane has tried to dub this cell. A dub that keeps failing stops after a few tries and the cell says why, rather than retrying every minute forever and showing nothing.';

-- The dub lane's claim query: cells whose job exists and whose audio does not.
-- Partial, because this is empty most of the time and finding that out should
-- cost nothing.
create index if not exists storefront_coverage_dub_idx
  on public.storefront_coverage (user_id, priority desc)
  where state = 'preparing' and sync_job_id is not null;

notify pgrst, 'reload schema';
