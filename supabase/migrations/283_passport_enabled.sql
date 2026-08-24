-- 283 — Passport Links opt-in flag.
--
-- Master per-creator toggle: when on, MVP emits Passport Links (geo-routing) in
-- place of plain tagged Amazon links for that creator. Off by default so nothing
-- changes for anyone until they turn it on. The per-country tags themselves live
-- on wordpress_sites.amazon_country_tags (migration 282).

alter table public.integrations
  add column if not exists passport_links_enabled boolean not null default false;

-- Account-level per-country tags — the fallback the redirect uses when a link
-- isn't tied to a specific site (single-site / legacy creators). Per-site tags on
-- wordpress_sites.amazon_country_tags take precedence when present.
alter table public.integrations
  add column if not exists amazon_country_tags jsonb not null default '{}'::jsonb;

notify pgrst, 'reload schema';
