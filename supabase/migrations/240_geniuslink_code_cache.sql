-- Per-user, per-ASIN cache of created Geniuslink short codes.
--
-- Geniuslink's create-link API is intermittently slow (their ServiceStack
-- backend times out our 3×15s attempts), which silently drops the YouTube
-- Co-Pilot to the plain Amazon-Associates-tag fallback and loses geo-routing.
-- Once we have a geni.us code for an ASIN we cache it here and reuse it forever
-- instead of re-hitting their flaky endpoint. Result: any product the creator
-- reviews (or simply Regenerates) more than once always ships a geni.us link,
-- and we stop hammering the slow API. Written server-side via the service-role
-- client only; RLS lets a user read their own rows.
create table if not exists public.geniuslink_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asin text not null,
  code text not null,
  destination text,
  created_at timestamptz not null default now(),
  unique (user_id, asin)
);

create index if not exists geniuslink_codes_user_asin_idx
  on public.geniuslink_codes (user_id, asin);

alter table public.geniuslink_codes enable row level security;

-- Owner can read their own cached codes; inserts/updates are service-role only.
drop policy if exists "geniuslink_codes_select_own" on public.geniuslink_codes;
create policy "geniuslink_codes_select_own" on public.geniuslink_codes
  for select using (auth.uid() = user_id);
