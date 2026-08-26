-- 297 — Brand Radar (LABS): brand enrichment + creator-sync jobs.
--
-- Two parts:
--  1. A real BRAND on each storefront product. The catalog only had asin/title/
--     image; brand is what powers "Brands you've worked with" and fixes rows whose
--     only title is the ASIN. Filled by Keepa enrichment (internal, never surfaced).
--  2. creator_sync_jobs — tracks a background ingestion run (Amazon storefront or
--     TikTok) through a provider (Apify / SocialCrawl). The sync is async: we start
--     a run, store the row, and a provider webhook/poll finishes it. Vendor-agnostic
--     so we can use SocialCrawl for TikTok and Apify for Amazon and swap either.
-- Idempotent.

alter table public.storefront_catalog
  add column if not exists brand text,
  add column if not exists brand_synced_at timestamptz;

create index if not exists storefront_catalog_user_brand_idx
  on public.storefront_catalog (user_id, brand);

create table if not exists public.creator_sync_jobs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  source          text not null,             -- 'amazon_storefront' | 'tiktok'
  provider        text not null,             -- 'apify' | 'socialcrawl'
  handle          text,                       -- storefront handle / tiktok username
  external_run_id text,                       -- the provider's run id (Apify runId)
  external_dataset_id text,                   -- Apify default dataset id
  status          text not null default 'running',  -- 'running' | 'succeeded' | 'failed'
  item_count      integer,                    -- rows ingested
  cursor          text,                       -- incremental marker (last item date, etc.)
  result          jsonb,                      -- summary payload (e.g. TikTok brand aggregation)
  error           text,
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index if not exists creator_sync_jobs_user_idx
  on public.creator_sync_jobs (user_id, created_at desc);
create index if not exists creator_sync_jobs_run_idx
  on public.creator_sync_jobs (external_run_id);

alter table public.creator_sync_jobs enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'creator_sync_jobs' and policyname = 'own sync jobs read'
  ) then
    create policy "own sync jobs read" on public.creator_sync_jobs
      for select using (auth.uid() = user_id);
  end if;
end $$;

notify pgrst, 'reload schema';
