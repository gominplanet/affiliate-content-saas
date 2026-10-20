-- Migration 449: what people type into the search boxes, remembered.
--
-- Seb, 2026-10-20: "I don't mind that MVP collects and remembers these tags
-- to make it a lot faster for people ... We could build from what people
-- actually type into YouTube search boxes ... check the main keyword against
-- Google search suggestion the same way." YouTube's, Google's and Amazon's
-- search suggestions for a seed (lib/search-suggest), kept for a week and
-- shared, so the next member writing about the same thing gets them at once.
-- Only MVP's server reads or writes it.
--
-- Safe to run twice.
create table if not exists public.search_suggestions (
  engine text not null,
  seed text not null,
  phrases text[] not null default '{}',
  seen_at timestamptz not null default now(),
  primary key (engine, seed)
);
alter table public.search_suggestions enable row level security;
notify pgrst, 'reload schema';
