-- THE CREATOR'S LOOK FOR THE REVIEW EDITOR (Seb, 2026-10-30: "Can we clean
-- this up?"). The logo, title style, pictures and edit choices every new
-- video starts from, saved once on the page instead of borrowed from the last
-- video made. Read and written only by MVP's server (lib/review-edit-server
-- editDb), so row level security is on with no policies. Safe to run twice.
create table if not exists public.review_edit_looks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.review_edit_looks enable row level security;
