-- Migration 378: reports about mvpl.ink links, from anyone.
--
-- The mvpl.ink front page has always said "if you find a link that does not
-- point to a retail product, report it and it will be switched off". Until now
-- that meant an email nobody tracked, and no screen to switch one off. This is
-- the record behind the promise, and the thing to show Pinterest when asking
-- them to review the domain: reports arrive, get looked at, and bad links stop.
--
-- state:
--   open           not looked at yet
--   link_disabled  the link was switched off (passport_links.disabled)
--   dismissed      looked at, the link is fine
--
-- Written only by the server (service role). No policies: nobody reads or
-- writes this table with their own session.
--
-- Safe to run twice.

create table if not exists public.link_reports (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  reason          text not null,
  details         text,
  reporter_email  text,
  reporter_hash   text,
  link_user_id    uuid,
  link_found      boolean not null default false,
  state           text not null default 'open',
  handled_at      timestamptz,
  handled_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists link_reports_open_idx on public.link_reports (state, created_at desc);
create index if not exists link_reports_hash_idx on public.link_reports (reporter_hash, created_at desc);
alter table public.link_reports enable row level security;

-- Passport links carry a disabled switch since migration 319. Repeated here
-- so this migration works on its own.
alter table if exists public.passport_links
  add column if not exists disabled boolean not null default false;
