-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 232 — turn support tickets into threads.
--
-- Until now a ticket was one-shot: a user's message + a single admin_response.
-- A back-and-forth (e.g. a creator replying to ask a follow-up) meant opening a
-- brand-new ticket, so the conversation scattered across disconnected rows.
--
-- This adds support_messages: one row per message in a ticket, from either side.
-- support_tickets stays the thread container (subject, status, tier, priority).
-- The ticket stays OPEN through unlimited back-and-forth; only an explicit Close
-- ends it, and a new user message on an answered/closed ticket reopens it.
--
-- Backfill: every existing ticket's original body becomes its first user
-- message, and any admin_response becomes an admin message — so no history is
-- lost and the old single-reply tickets render as one-exchange threads.

create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  sender      text not null check (sender in ('user', 'admin')),
  body        text not null,
  seen        boolean not null default false,  -- for admin messages: has the user read it (clears the bell)
  created_at  timestamptz not null default now()
);

create index if not exists support_messages_ticket_idx
  on public.support_messages (ticket_id, created_at asc);

alter table public.support_messages enable row level security;

-- Users can read every message in a ticket they own.
drop policy if exists support_messages_select_own on public.support_messages;
create policy support_messages_select_own on public.support_messages
  for select using (
    exists (
      select 1 from public.support_tickets t
      where t.id = support_messages.ticket_id and t.user_id = auth.uid()
    )
  );

-- Users can post a 'user' message into a ticket they own. Admin messages are
-- written server-side with the service-role key (bypasses RLS), so there is no
-- user policy for sender='admin'.
drop policy if exists support_messages_insert_own on public.support_messages;
create policy support_messages_insert_own on public.support_messages
  for insert with check (
    sender = 'user'
    and exists (
      select 1 from public.support_tickets t
      where t.id = support_messages.ticket_id and t.user_id = auth.uid()
    )
  );

comment on table public.support_messages is
  'Individual messages in a support ticket thread (migration 232). sender: user|admin. seen tracks whether the user has read an admin message (drives the bell). support_tickets is the thread container.';

-- ── Backfill existing tickets into the thread model ────────────────────────
-- Guard each insert against re-running: only seed a ticket that has NO messages
-- yet, so applying this migration twice never duplicates the history.

-- 1. Original ticket body → first user message (dated at the ticket's creation).
insert into public.support_messages (ticket_id, sender, body, seen, created_at)
select t.id, 'user', t.body, true, t.created_at
from public.support_tickets t
where t.body is not null
  and not exists (select 1 from public.support_messages m where m.ticket_id = t.id);

-- 2. Any admin_response → an admin message (dated at responded_at, carrying the
--    ticket's response_seen so the bell state is preserved). Only for tickets
--    that now have exactly the one seeded user message (i.e. weren't already
--    threaded), so we don't append a stale reply to a live thread on re-run.
insert into public.support_messages (ticket_id, sender, body, seen, created_at)
select t.id, 'admin', t.admin_response, t.response_seen, coalesce(t.responded_at, t.updated_at, t.created_at)
from public.support_tickets t
where t.admin_response is not null
  and length(btrim(t.admin_response)) > 0
  and (select count(*) from public.support_messages m where m.ticket_id = t.id) = 1;
