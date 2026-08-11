-- Migration 245: app_errors — a place for server-side failures to surface.
--
-- The YouTube-disconnect bug ran broken for who-knows-how-long because the code
-- ignored the database error and reported success. This table gives silent
-- failures somewhere to land: reportDbError() (lib/db-error.ts) writes here via
-- the service-role client, and an admin can read recent rows instead of waiting
-- for a support ticket.

create table if not exists public.app_errors (
  id         uuid primary key default gen_random_uuid(),
  context    text not null,          -- e.g. 'youtube.disconnect.clear'
  message    text,                   -- the error message (truncated)
  user_id    uuid,                   -- affected user, when known
  meta       jsonb,                  -- small structured context
  created_at timestamptz not null default now()
);

create index if not exists app_errors_created_idx on public.app_errors (created_at desc);
create index if not exists app_errors_context_idx on public.app_errors (context);

-- RLS on, no policies: only the service-role client (which bypasses RLS) can
-- read or write. No user ever sees this table.
alter table public.app_errors enable row level security;
