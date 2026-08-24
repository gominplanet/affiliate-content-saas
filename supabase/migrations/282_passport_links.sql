-- 282 — Passport Links: MVP-native geo-routing affiliate links + click analytics.
--
-- One link per product that sends each visitor to THEIR country's Amazon store
-- with the creator's tag for that country (the same thing Geniuslink/OneLink do,
-- but MVP owns the redirect, so it's free and works on blog + social alike).
--
--   creator drops mvpl.ink/x7k  →  MVP reads the click's country  →  302 to
--   amazon.<tld>/dp/<asin>?tag=<that country's tag>   (falls back to the US tag)
--
-- Every redirect is logged so the creator gets a clicks/countries dashboard.

-- Per-country Amazon Associates tags, per site. The US/default tag stays in
-- wordpress_sites.amazon_associates_tag (migration 280); this adds the others as a
-- { "GB": "brand-21", "DE": "brand-21", ... } map (ISO-3166 alpha-2 keys).
alter table public.wordpress_sites
  add column if not exists amazon_country_tags jsonb not null default '{}'::jsonb;

-- One short-coded smart link per (site, product), created lazily when first needed.
create table if not exists public.passport_links (
  code        text primary key,          -- short base62 id shown in the URL
  user_id     uuid not null references auth.users(id) on delete cascade,
  site_id     uuid references public.wordpress_sites(id) on delete set null,
  asin        text not null,
  label       text,                       -- product title, for the dashboard
  created_at  timestamptz not null default now(),
  unique (user_id, site_id, asin)
);
create index if not exists passport_links_user_idx on public.passport_links (user_id, created_at desc);

-- Click log — one row per redirect. Lean on purpose; aggregated for the dashboard.
create table if not exists public.passport_link_clicks (
  id          bigserial primary key,
  code        text not null references public.passport_links(code) on delete cascade,
  user_id     uuid not null,
  country     text,                       -- ISO-3166 alpha-2, uppercased (visitor)
  marketplace text,                        -- the amazon domain we sent them to
  source      text,                        -- 'blog' | 'social' | referrer host
  created_at  timestamptz not null default now()
);
create index if not exists passport_clicks_user_time_idx on public.passport_link_clicks (user_id, created_at desc);
create index if not exists passport_clicks_code_idx on public.passport_link_clicks (code);
create index if not exists passport_clicks_country_idx on public.passport_link_clicks (user_id, country);

-- RLS: creators see only their own links + clicks. The public redirect runs with
-- the service-role (admin) client, so it resolves + logs without a session.
alter table public.passport_links enable row level security;
alter table public.passport_link_clicks enable row level security;
drop policy if exists passport_links_own on public.passport_links;
create policy passport_links_own on public.passport_links
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists passport_clicks_own on public.passport_link_clicks;
create policy passport_clicks_own on public.passport_link_clicks
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
