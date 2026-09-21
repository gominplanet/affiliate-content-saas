-- 358 — the columns the launch worker needs. Run after 357.
--
-- Four additions, each one closing a gap where a screen would otherwise have to
-- guess.
--
-- cta_chosen           "no CTA on any of them" and "they have not decided yet"
--                      are both an empty cta column, and a batch would sit
--                      waiting for an answer the creator had already given. The
--                      decision is recorded separately from its value.
--
-- planned_publish_at   WHAT WE INTEND, kept apart from publish_at, which is
--                      what YouTube confirmed. Collapsing them lets a screen
--                      promise a publication that was never scheduled, which is
--                      the failure shape this codebase has produced over and
--                      over in other guises.
--
-- *_tries              A video that keeps failing stops asking and says why.
--                      Without a count, a render that dies every time retries
--                      every minute forever and the board shows nothing at all.
--
-- Safe to run more than once.

do $$
begin
  if to_regclass('public.launch_batches') is null then
    raise exception 'launch_batches is missing. Run migration 357 first, then this one.';
  end if;
end $$;

alter table public.launch_batches
  add column if not exists cta_chosen boolean not null default false;

comment on column public.launch_batches.cta_chosen is
  'True once the creator has decided, INCLUDING deciding on no CTA at all. Without it, "none" and "not asked yet" are the same empty cta column and the worker would wait forever for an answer it already has.';

alter table public.launch_items
  add column if not exists planned_publish_at timestamptz,
  add column if not exists render_tries  integer not null default 0,
  add column if not exists thumb_tries   integer not null default 0,
  add column if not exists publish_tries integer not null default 0;

comment on column public.launch_items.planned_publish_at is
  'When this video is MEANT to go public, written when the batch is launched. publish_at is what YouTube actually confirmed. They are separate on purpose: a screen reading the plan would promise a publication that never happened.';

-- The publish step's claim query: prepared, planned, earliest first, so the
-- batch goes up in the order it will appear on the channel.
create index if not exists launch_items_publish_idx
  on public.launch_items (planned_publish_at)
  where state = 'prepared' and planned_publish_at is not null;

notify pgrst, 'reload schema';
