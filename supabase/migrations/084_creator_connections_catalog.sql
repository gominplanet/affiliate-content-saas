-- 084_creator_connections_catalog.sql
-- Shared Amazon Creator Connections catalog. Admin uploads the weekly
-- export .zip; this table holds the parsed result. All authenticated
-- users can read; only admin (via service-role) can write.
--
-- Replaces the per-user client-side .zip upload on the Creator Campaigns
-- page — users now query a centralized catalog the admin refreshes weekly,
-- so they don't each have to know where the Amazon export lives.

create table if not exists public.creator_connections_catalog (
  id uuid primary key default gen_random_uuid(),
  asin text not null,
  campaign_id text not null,
  campaign_name text,
  brand text,
  commission numeric,
  ends_at date,
  days_left integer,
  budget_remain numeric default 0,
  slots_available numeric default 0,
  has_budget_and_slots boolean default false,
  imported_at timestamptz default now(),
  raw_row jsonb
);

create unique index if not exists creator_connections_catalog_unq
  on public.creator_connections_catalog (campaign_id, asin);
create index if not exists creator_connections_catalog_commission_idx
  on public.creator_connections_catalog (commission desc);
create index if not exists creator_connections_catalog_days_idx
  on public.creator_connections_catalog (days_left);
create index if not exists creator_connections_catalog_brand_idx
  on public.creator_connections_catalog (lower(brand));
create index if not exists creator_connections_catalog_budget_idx
  on public.creator_connections_catalog (has_budget_and_slots);
create index if not exists creator_connections_catalog_imported_idx
  on public.creator_connections_catalog (imported_at desc);
-- pg_trgm GIN indexes so the user-facing keyword search (ILIKE) can use
-- an index instead of full-scanning 470k rows. Without these the search
-- route times out on any non-trivial dataset. Trigram indexes are faster
-- to maintain on bulk insert than tsvector GIN, so worth the upfront cost.
create extension if not exists pg_trgm;
create index if not exists creator_connections_catalog_name_trgm_idx
  on public.creator_connections_catalog
  using gin (campaign_name gin_trgm_ops);
create index if not exists creator_connections_catalog_brand_trgm_idx
  on public.creator_connections_catalog
  using gin (brand gin_trgm_ops);

alter table public.creator_connections_catalog enable row level security;
create policy "Authenticated read" on public.creator_connections_catalog
  for select using (auth.uid() is not null);
-- No INSERT/UPDATE/DELETE policies: those go through service-role only,
-- gated by tier='admin' check in /api/admin/creator-campaigns/import.
