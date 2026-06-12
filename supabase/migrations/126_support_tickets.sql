-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 126 — support tickets (onboarding-epic Phase 3).
--
-- A fully IN-APP user→admin help-ticket loop:
--   1. User submits a ticket from /support (subject + body).
--   2. Founder sees it at /admin/support-tickets, types a reply, marks answered.
--   3. User reads the reply back on /support; a bell notification points there.
-- The reply lives in MVP — no email round-trip to deliver it. The ONLY email is
-- an optional one-line alert to the founder when a NEW ticket lands so they
-- don't have to keep refreshing the admin inbox.
--
-- Mirrors the job_failures shape: one row per ticket. RLS lets a user read +
-- create only their OWN tickets; the admin inbox reads/updates everything via
-- the service-role key (createAdminClient), which bypasses RLS — so there is no
-- user UPDATE policy (users never edit a row directly; "mark response seen" is
-- done server-side with the admin client).

create table if not exists public.support_tickets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  email          text,                            -- denormalised reply-to / display
  subject        text not null,
  body           text not null,
  status         text not null default 'open',    -- open | answered | closed
  admin_response text,
  responded_at   timestamptz,
  response_seen  boolean not null default false,  -- user has viewed the reply (clears the bell)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists support_tickets_user_idx
  on public.support_tickets (user_id, created_at desc);
create index if not exists support_tickets_status_idx
  on public.support_tickets (status, created_at desc);

alter table public.support_tickets enable row level security;

-- Users can read only their own tickets.
drop policy if exists support_tickets_select_own on public.support_tickets;
create policy support_tickets_select_own on public.support_tickets
  for select using (auth.uid() = user_id);

-- Users can create tickets attributed to themselves.
drop policy if exists support_tickets_insert_own on public.support_tickets;
create policy support_tickets_insert_own on public.support_tickets
  for insert with check (auth.uid() = user_id);

comment on table public.support_tickets is
  'In-app help tickets (onboarding-epic Phase 3). User submits from /support; admin replies at /admin/support-tickets via the service-role key; user reads the reply back in-app. status: open|answered|closed.';
