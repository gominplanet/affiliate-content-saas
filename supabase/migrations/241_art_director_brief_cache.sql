-- Shared art-director brief cache (the "shared creative thinking" the Amazon
-- tier's social volumes are priced on).
--
-- A design generation is two costs: the art-director brief (the Claude
-- reasoning step that decides layout, palette, headline and callouts, ~$0.02)
-- and the gpt-image render (~$0.06). The brief is format-agnostic, so when a
-- creator pushes one product to several networks (pin, IG story, FB post) we
-- run the brief ONCE and reuse it, paying only the per-format render each time.
-- Keyed by (user_id, brief_key); the caller mints a brief_key per post set so a
-- Regenerate makes a fresh brief while a cross-post reuses the stored one.
-- Written server-side via the service-role client only; RLS lets a user read
-- their own rows.
create table if not exists public.art_director_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brief_key text not null,
  briefs jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, brief_key)
);

create index if not exists art_director_briefs_user_key_idx
  on public.art_director_briefs (user_id, brief_key);

alter table public.art_director_briefs enable row level security;

-- Owner can read their own cached briefs; inserts/updates are service-role only.
drop policy if exists "art_director_briefs_select_own" on public.art_director_briefs;
create policy "art_director_briefs_select_own" on public.art_director_briefs
  for select using (auth.uid() = user_id);
