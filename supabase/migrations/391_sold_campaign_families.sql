-- 391: sold campaigns match other colours and sizes, and accept themselves daily.
--
-- asin_families: a product's parent listing and its sibling variations (other
-- colours, sizes, styles), from Keepa, shared by everyone like the other
-- product caches, looked up again after 30 days.
--
-- cc_campaign_catalog.parent_asin already exists (enrichment fills it); the
-- index lets a creator's parents be matched against it.
--
-- integrations.sold_campaigns_auto: off only when false (null means on), and
-- sold_campaigns_auto_at: the last day MVP accepted for them.
--
-- Safe to run more than once.
create table if not exists public.asin_families (
  asin        text primary key,
  parent_asin text,
  siblings    text[] not null default '{}',
  attrs       text,
  checked_at  timestamptz not null default now()
);
create index if not exists asin_families_parent on public.asin_families (parent_asin) where parent_asin is not null;

alter table public.asin_families enable row level security;
drop policy if exists asin_families_read on public.asin_families;
create policy asin_families_read on public.asin_families for select to authenticated using (true);

create index if not exists cc_catalog_parent_asin_idx
  on public.cc_campaign_catalog (parent_asin) where parent_asin is not null;

alter table public.integrations add column if not exists sold_campaigns_auto boolean;
alter table public.integrations add column if not exists sold_campaigns_auto_at timestamptz;

notify pgrst, 'reload schema';
