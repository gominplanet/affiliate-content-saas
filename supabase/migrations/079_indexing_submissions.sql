-- 079 — Track per-user Indexing API submissions
--
-- One row per submit attempt. Powers two things:
--   1. Daily soft-cap on the route (50/user/24h) so one creator can't
--      burn the shared Google Cloud project's 200/day quota.
--   2. "Submitted X hours ago" badges on the SEO dashboard so creators
--      can see which posts they already pushed without trying again.
--
-- outcome enum (kept as text for forward-compat):
--   'submitted'  — Google returned 200, accepted for crawl
--   'quota'      — 429 — project quota for the day exhausted
--   'forbidden'  — 403 — scope missing OR token doesn't own the URL
--   'unknown'    — anything else (logged with the response body)

create table if not exists public.indexing_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,
  outcome text not null,
  message text,
  created_at timestamptz not null default now()
);
alter table public.indexing_submissions enable row level security;
drop policy if exists "Users see own indexing submissions" on public.indexing_submissions;
create policy "Users see own indexing submissions" on public.indexing_submissions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Fast daily-cap query: count for a user since 24h ago.
create index if not exists indexing_submissions_user_created_idx
  on public.indexing_submissions (user_id, created_at desc);
-- Fast "when did I last submit THIS URL?" lookup for the dashboard badge.
create index if not exists indexing_submissions_user_url_idx
  on public.indexing_submissions (user_id, url, created_at desc);
