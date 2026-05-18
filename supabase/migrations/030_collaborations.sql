-- Migration 030: brand collaboration pitch emails
--
-- Stores each collaboration pitch: the target brand + the creator's
-- answers + the AI-composed outreach email, so the user can revisit,
-- re-copy, and track which brands they've pitched. Pro-tier feature.

create table if not exists public.collaborations (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  brand_name            text not null,
  amazon_storefront     text,
  website_url           text,
  youtube_url           text,
  platforms             text[] not null default '{}',
  banner_ads            boolean not null default false,
  free_sample           boolean not null default false,
  production_fee        boolean not null default false,
  production_fee_amount text,
  share_address         boolean not null default false,
  collabs_done          text,
  extra_notes           text,
  generated_email       text,
  created_at            timestamptz not null default now()
);

create index if not exists collaborations_user_idx
  on public.collaborations (user_id, created_at desc);

alter table public.collaborations enable row level security;

drop policy if exists "collaborations_select_own" on public.collaborations;
create policy "collaborations_select_own" on public.collaborations
  for select using (auth.uid() = user_id);

drop policy if exists "collaborations_insert_own" on public.collaborations;
create policy "collaborations_insert_own" on public.collaborations
  for insert with check (auth.uid() = user_id);

drop policy if exists "collaborations_update_own" on public.collaborations;
create policy "collaborations_update_own" on public.collaborations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "collaborations_delete_own" on public.collaborations;
create policy "collaborations_delete_own" on public.collaborations
  for delete using (auth.uid() = user_id);
