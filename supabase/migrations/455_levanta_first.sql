-- Migration 455: Levanta links when they pay more (lib/levanta-first).
--
-- Seb, 2026-10-24: "could mvp let users use levanta links when possible?"
-- A creator who connected Levanta can turn on "Use Levanta links when they
-- pay more". Every Amazon product link MVP makes then checks, once per
-- product, whether Levanta has it for this creator and at what commission,
-- and uses the Levanta link unless the product's Creator Connections campaign
-- pays as much or more.
--   integrations.prefer_levanta  the creator's switch, off unless turned on.
--   levanta_links                one row per creator and product: the
--                                Levanta link when MVP may use it, Levanta's
--                                commission, the Creator Connections rate it
--                                was compared with, what MVP decided and when.
-- Read with select('*') and written by the server, so before this runs the
-- switch reads as off and nothing changes.
--
-- Safe to run twice.
alter table public.integrations add column if not exists prefer_levanta boolean not null default false;

create table if not exists public.levanta_links (
  user_id       uuid not null references auth.users(id) on delete cascade,
  asin          text not null,
  url           text,
  commission    numeric,
  cc_commission numeric,
  state         text not null,
  checked_at    timestamptz not null default now(),
  used_at       timestamptz,
  primary key (user_id, asin)
);

alter table public.levanta_links enable row level security;
drop policy if exists "levanta_links_own_read" on public.levanta_links;
create policy "levanta_links_own_read" on public.levanta_links
  for select using (user_id = auth.uid());

notify pgrst, 'reload schema';
