-- GOOGLE DRIVE FOR THE REVIEW EDITOR (Seb, 2026-10-30: "I would love for MVP
-- to very soon be able to read someone's Google Drive"). One row per creator:
-- the lasting Google access for the files they pick in Google's own picker
-- (the drive.file permission: only those files, nothing else in their Drive).
-- The token is encrypted before it is written. Read by the server only, so
-- no one can read it through the API. Safe to run twice.
create table if not exists public.google_drive_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  refresh_token text not null,
  email text,
  scope text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.google_drive_links enable row level security;
