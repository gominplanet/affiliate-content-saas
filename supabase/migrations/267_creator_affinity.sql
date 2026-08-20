-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 267 — per-creator affinity profile (Channel-fit Matching).
--
-- The signals that describe what actually works for a creator: the categories
-- their storefront EARNS in (weighted by real commission), the keywords/topics
-- from their YouTube titles + earning products, and the price band their buyers
-- convert at. Computed from data we already hold (storefront_earnings +
-- youtube_videos + the product caches) and cached here so the "Made for your
-- channel" feed can score products without recomputing every load. Refreshed by
-- a light nightly pass and on demand.

create table if not exists public.creator_affinity (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  -- [{ name, weight }] — top earning categories, weight 0..1 (share of commission).
  categories       jsonb not null default '[]',
  -- string[] — topic keywords from video titles + earning-product titles.
  keywords         jsonb not null default '[]',
  -- The price band their buyers actually convert at (cents), or null when unknown.
  price_min_cents  integer,
  price_max_cents  integer,
  -- How many earning products informed this profile (confidence signal).
  sample_size      integer not null default 0,
  computed_at      timestamptz not null default now()
);

alter table public.creator_affinity enable row level security;

-- A creator may read their own profile; only the service role writes it.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'creator_affinity' and policyname = 'creator_affinity_read_own'
  ) then
    create policy creator_affinity_read_own on public.creator_affinity
      for select to authenticated using (auth.uid() = user_id);
  end if;
end $$;
