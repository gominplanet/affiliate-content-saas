-- 308 — Favorite brands watchlist for Creator Connections.
--
-- Creators track their go-to brands (e.g. Levoit) and MVP checks them on a
-- schedule so they don't have to watch daily for a full campaign to reopen.
-- From the watchlist they can bulk-accept or bulk-message every open campaign
-- for a brand in one go.
--
-- brand_key is the normalized (lowercased, trimmed) name used for matching
-- against cc_campaign_catalog.brand_name; brand_label is what the creator typed,
-- for display. open_count / last_checked_at are refreshed by the background cron
-- (check-favorite-brands); notified_open_at guards against re-notifying while a
-- brand stays open.

create table if not exists public.cc_favorite_brands (
  user_id          uuid not null references auth.users(id) on delete cascade,
  brand_key        text not null,
  brand_label      text not null,
  created_at       timestamptz not null default now(),
  open_count       int not null default 0,
  last_checked_at  timestamptz,
  notified_open_at timestamptz,
  primary key (user_id, brand_key)
);

create index if not exists cc_favorite_brands_user_idx on public.cc_favorite_brands (user_id);

alter table public.cc_favorite_brands enable row level security;

-- Each creator sees and manages only their own favorites. The cron uses the
-- service-role admin client, which bypasses RLS.
create policy "own cc favorites" on public.cc_favorite_brands
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

notify pgrst, 'reload schema';
