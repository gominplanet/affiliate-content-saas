-- 270 — Storefront catalog (every product the creator features, past the ~100 cap).
--
-- The earnings report's grouped view caps at ~100 rows, so storefront_earnings
-- only holds the top earners. The creator's PUBLIC storefront (amazon.com/shop/
-- <handle>) lists ALL products they feature — no cap, no auth. SCOUT walks the
-- storefront's idea lists and records every product here. The storefront view
-- then shows the full catalog and overlays the REAL earnings (from
-- storefront_earnings) on the ones that have them.
--
-- Public catalog data only (asin/title/image/which shelf). Idempotent.

create table if not exists public.storefront_catalog (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asin text not null,
  title text,
  image_url text,
  list_title text,
  synced_at timestamptz not null default now(),
  unique (user_id, asin)
);

create index if not exists storefront_catalog_user_idx
  on public.storefront_catalog (user_id);

alter table public.storefront_catalog enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'storefront_catalog'
      and policyname = 'own catalog read'
  ) then
    create policy "own catalog read" on public.storefront_catalog
      for select using (auth.uid() = user_id);
  end if;
end $$;

notify pgrst, 'reload schema';
