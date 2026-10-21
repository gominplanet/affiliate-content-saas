-- Migration 452: how known each TRYBE brand is (lib/brand-popularity).
--
-- Seb, 2026-10-21: "can we also look at the website's brand and see the
-- traffic they create or they get? That will also give us like an idea of
-- how viral or how searched their brand is". Read in the background for the
-- shared TRYBE directory (cron trybe-directory), highest TRYBE score first:
--   web_domain / web_rank / web_rank_was / web_rank_days / web_rank_checked_at
--     the brand's own domain, its rank among the world's websites (Tranco
--     list), the earliest rank in Tranco's answer and the days between, and
--     when it was read. Read with no rank: not ranked (few visitors). Read
--     with no domain: its website is a page on a shared site.
--   google_searches / google_phrases / google_checked_at
--     how many of Google's search suggestions start with the brand's name,
--     and which.
-- Not read is null with no checked_at, never zero.
--
-- Safe to run twice.
alter table public.trybe_directory add column if not exists web_domain text;
alter table public.trybe_directory add column if not exists web_rank integer;
alter table public.trybe_directory add column if not exists web_rank_was integer;
alter table public.trybe_directory add column if not exists web_rank_days integer;
alter table public.trybe_directory add column if not exists web_rank_checked_at timestamptz;
alter table public.trybe_directory add column if not exists google_searches integer;
alter table public.trybe_directory add column if not exists google_phrases text[] not null default '{}';
alter table public.trybe_directory add column if not exists google_checked_at timestamptz;

create index if not exists trybe_directory_web_rank_todo_idx
  on public.trybe_directory (trybe_score desc nulls last) where web_rank_checked_at is null;
create index if not exists trybe_directory_google_todo_idx
  on public.trybe_directory (trybe_score desc nulls last) where google_checked_at is null;

notify pgrst, 'reload schema';
