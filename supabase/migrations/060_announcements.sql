-- 060 — announcements: admin-editable dashboard news banner
--
-- One row per published announcement. The dashboard banner shows the most
-- recent row with active = true; "Publish" inserts a new active row (and
-- deactivates the rest), so each new message gets a fresh id and re-shows to
-- everyone even if they dismissed the previous one. "Hide" flips active off.
--
-- All reads/writes go through the service-role API routes (GET /api/announcement,
-- POST /api/admin/announcement), so RLS is enabled with NO policies — direct
-- client access is denied; the service role bypasses RLS.

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  active      boolean not null default true,
  title       text not null,
  body        text not null,
  cta_label   text,
  cta_href    text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists announcements_active_created_idx
  on public.announcements (active, created_at desc);

alter table public.announcements enable row level security;
-- Intentionally no policies — access is service-role only via the API routes.
