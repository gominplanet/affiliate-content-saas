-- 130 — support-ticket priority (backs the "priority support" claim)
--
-- Pro/Studio plans advertise priority support. Stamp each ticket with the
-- submitter's tier + a priority flag at creation so the admin inbox can surface
-- paying customers' tickets first, and so the Discord webhook can flag them.
--
-- Idempotent: add-column-if-not-exists + create-index-if-not-exists.

alter table public.support_tickets
  add column if not exists tier     text,
  add column if not exists priority boolean not null default false;

-- Priority-first ordering for the admin inbox (priority desc, then recency).
create index if not exists support_tickets_priority_idx
  on public.support_tickets (priority, status, created_at desc);
