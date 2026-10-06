-- 417: TRYBE brand directory (Labs). Every brand on TRYBE, in MVP.
--
-- Seb, 2026-10-06: TRYBE's search "does not work very well ... we should have
-- scout get all of the brands and website in one go ... and from there make
-- our own filtration". SCOUT reads TRYBE's own brand list (5,917 brands that
-- day) from the creator's signed-in TRYBE tab; MVP keeps it here, reads each
-- brand's website once in the background (cron trybe-directory), and searches
-- it by the creator's categories and keywords.
--
-- Shared by every member: the list is the same for all of them, so it is
-- collected and read once. Members' own requests stay in trybe_brands.
-- Written and read by the server only (no policies).
--
-- Safe to run twice.

create table if not exists public.trybe_directory (
  brand_id         text        primary key,
  name             text        not null,
  website          text,
  categories       text[]      not null default '{}',
  about            text,
  pay_text         text,
  trybe_score      integer,
  total_creators   integer,
  rating           numeric,
  raw              jsonb,
  search_text      text,
  site_summary     text,
  site_products    text[]      not null default '{}',
  site_text        text,
  site_error       text,
  site_fetched_at  timestamptz,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);

create index if not exists trybe_directory_unread_idx
  on public.trybe_directory (trybe_score desc nulls last) where site_fetched_at is null and website is not null;
create index if not exists trybe_directory_seen_idx
  on public.trybe_directory (last_seen_at desc);

alter table public.trybe_directory enable row level security;

-- TRYBE's own category list, as last read.
create table if not exists public.trybe_directory_meta (
  key         text        primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now()
);
alter table public.trybe_directory_meta enable row level security;

notify pgrst, 'reload schema';
