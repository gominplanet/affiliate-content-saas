-- 310 — Per-campaign acceptance ledger.
--
-- The `campaigns` table is keyed (user_id, asin) and holds ONE cc_campaign_id per
-- row. Amazon runs several distinct campaigns for the same product (same ASIN,
-- different windows), so accepting them all overwrote that single cc_campaign_id
-- and only ONE campaign got recorded by id — the others still counted as "open",
-- so Accept all never drove a brand's count to zero.
--
-- This ledger records EVERY accepted campaign by its own id (many per ASIN), so
-- the favorite-brands open counts and the Accept/Message source can exclude every
-- campaign the creator has actually joined.
create table if not exists public.cc_accepted_campaigns (
  user_id      uuid not null references auth.users(id) on delete cascade,
  campaign_id  text not null,
  brand_name   text,
  asin         text,
  accepted_at  timestamptz not null default now(),
  primary key (user_id, campaign_id)
);

create index if not exists cc_accepted_campaigns_user_idx
  on public.cc_accepted_campaigns (user_id);

alter table public.cc_accepted_campaigns enable row level security;

drop policy if exists "own accepted campaigns" on public.cc_accepted_campaigns;
create policy "own accepted campaigns" on public.cc_accepted_campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
