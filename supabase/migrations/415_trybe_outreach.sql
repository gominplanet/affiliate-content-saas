-- 415: TRYBE outreach (Labs).
--
-- SCOUT reads the brands in TRYBE's Discover Brands from inside the creator's
-- own TRYBE session. MVP studies each brand's website, drafts a first message
-- built on the creator's core message, and keeps a morning queue the creator
-- skims before pressing Send all. SCOUT then presses TRYBE's own Request to
-- Join for each, slowly, under a daily cap.
--
-- trybe_brands: one row per (user, TRYBE brand). `status` is what was SEEN,
-- never what was planned: 'sent' only when SCOUT saw TRYBE's request box close
-- after Send Request, 'already' when TRYBE itself showed the brand as requested.
-- 'sending' is a send MVP started and never heard back about; it counts toward
-- the daily cap so a lost answer can never lead to going over it.
--
-- trybe_outreach_settings: the creator's core message and daily cap.
--
-- Safe to run twice.

create table if not exists public.trybe_brands (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  brand_id         text        not null,
  name             text        not null,
  categories       text[]      not null default '{}',
  brand_url        text,
  website          text,
  about            text,
  pay_text         text,
  rating           numeric,
  reviews          integer,
  creator_earnings text,
  total_creators   integer,
  trybe_score      integer,
  site_summary     text,
  site_products    text[]      not null default '{}',
  site_fetched_at  timestamptz,
  site_error       text,
  status           text        not null default 'new',
  draft            text,
  drafted_at       timestamptz,
  sent_message     text,
  send_started_at  timestamptz,
  sent_at          timestamptz,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, brand_id)
);

alter table public.trybe_brands add column if not exists site_products text[] not null default '{}';
alter table public.trybe_brands add column if not exists site_error text;
alter table public.trybe_brands add column if not exists send_started_at timestamptz;

create index if not exists trybe_brands_user_status_idx
  on public.trybe_brands (user_id, status);
create index if not exists trybe_brands_user_sent_idx
  on public.trybe_brands (user_id, send_started_at desc);

alter table public.trybe_brands enable row level security;

drop policy if exists "trybe_brands own select" on public.trybe_brands;
create policy "trybe_brands own select" on public.trybe_brands
  for select using (auth.uid() = user_id);
drop policy if exists "trybe_brands own insert" on public.trybe_brands;
create policy "trybe_brands own insert" on public.trybe_brands
  for insert with check (auth.uid() = user_id);
drop policy if exists "trybe_brands own update" on public.trybe_brands;
create policy "trybe_brands own update" on public.trybe_brands
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "trybe_brands own delete" on public.trybe_brands;
create policy "trybe_brands own delete" on public.trybe_brands
  for delete using (auth.uid() = user_id);

create table if not exists public.trybe_outreach_settings (
  user_id       uuid        primary key references auth.users(id) on delete cascade,
  core_message  text,
  daily_cap     integer     not null default 20,
  updated_at    timestamptz not null default now()
);

alter table public.trybe_outreach_settings enable row level security;

drop policy if exists "trybe_outreach_settings own select" on public.trybe_outreach_settings;
create policy "trybe_outreach_settings own select" on public.trybe_outreach_settings
  for select using (auth.uid() = user_id);
drop policy if exists "trybe_outreach_settings own insert" on public.trybe_outreach_settings;
create policy "trybe_outreach_settings own insert" on public.trybe_outreach_settings
  for insert with check (auth.uid() = user_id);
drop policy if exists "trybe_outreach_settings own update" on public.trybe_outreach_settings;
create policy "trybe_outreach_settings own update" on public.trybe_outreach_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
