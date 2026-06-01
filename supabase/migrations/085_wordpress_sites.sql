-- 085 — wordpress_sites: per-user multi-site Pro feature
--
-- Pro tier can connect up to 5 WordPress sites (one per niche / client / project).
-- Studio + Creator stay at 1 site (the existing behaviour).
--
-- WHY a new table instead of widening integrations:
--   - integrations is one row per user; can't store multiple WP credentials there
--     without going JSON-only (which we'd then have to parse on every read).
--   - Cleanly per-site customizations (blog_customizations) can later move from
--     integrations.blog_customizations → wordpress_sites.blog_customizations.
--   - blog_posts gets a clean FK to which site it lives on, so cross-site
--     queries ("show me posts from my Wine blog only") are one .eq().
--
-- BACKWARDS COMPAT: integrations.wordpress_url / wordpress_username /
-- wordpress_app_password / wordpress_api_token stay in place until every route
-- has been migrated to the new table (Phase 3). Until then, reads can fall back
-- to integrations when wordpress_sites is empty for the user.

-- ── Table ──────────────────────────────────────────────────────────────────
create table if not exists public.wordpress_sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Free-text label the user types in. e.g. "Main", "Wine Reviews",
  -- "Tech Picks". Shown in the site picker. NULL allowed during initial
  -- backfill (label gets auto-filled to "Main" then).
  label text,
  -- WordPress site URL — must be a full URL incl. https://. We normalize on
  -- write (trailing slash stripped, lowercase host).
  url text not null,
  -- Application Password credentials. username + app_password match the
  -- existing integrations.wordpress_username / wordpress_app_password layout
  -- so backfill is a straight copy.
  username text not null,
  app_password text not null,
  -- Optional OAuth-flow token (currently unused but kept for parity with
  -- integrations.wordpress_api_token; some WP installs use it).
  api_token text,
  -- The DEFAULT site for this user. Generations + UI default to this site
  -- unless the user explicitly picks another in a site picker. Exactly one
  -- row per user can have is_default = true (enforced by partial index below).
  is_default boolean not null default false,
  -- Display order in the site list. Lowest first. Default sorts by created_at
  -- ascending so older sites stay where the user expects.
  display_order int not null default 0,
  -- Per-site blog customizations (mid-article ad slots, footer, pick of day,
  -- newsletter inline, etc.). NULL = inherit from integrations.blog_customizations
  -- for backwards compat; Phase 3 will move all writes here and stop reading
  -- the legacy column.
  blog_customizations jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One default site per user. Postgres' partial unique index lets us enforce
-- "at most one row where is_default = true" per user without blocking the
-- common case where every row is is_default = false.
create unique index if not exists wordpress_sites_one_default_per_user
  on public.wordpress_sites (user_id) where is_default;

-- Sites are looked up by user_id constantly; without this index every WP
-- route does a table scan.
create index if not exists wordpress_sites_user_id_idx
  on public.wordpress_sites (user_id);

-- Per-user max 5 sites — enforced by a CHECK that runs a count(). Cheap
-- because the index above makes the count a quick range scan.
create or replace function public.enforce_wordpress_sites_per_user_cap()
returns trigger as $$
begin
  if (select count(*) from public.wordpress_sites where user_id = new.user_id) > 5 then
    raise exception 'Pro plan supports up to 5 WordPress sites per account';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists wordpress_sites_cap_trigger on public.wordpress_sites;
create trigger wordpress_sites_cap_trigger
  after insert on public.wordpress_sites
  for each row execute function public.enforce_wordpress_sites_per_user_cap();

-- Auto-update updated_at on every row change so the dashboard can show
-- "last synced" without a separate column.
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists wordpress_sites_touch_trigger on public.wordpress_sites;
create trigger wordpress_sites_touch_trigger
  before update on public.wordpress_sites
  for each row execute function public.touch_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
-- Users can only see / write their own sites. Service role bypasses RLS
-- (Stripe webhooks, cron, OAuth callbacks).
alter table public.wordpress_sites enable row level security;

drop policy if exists wordpress_sites_select_own on public.wordpress_sites;
create policy wordpress_sites_select_own on public.wordpress_sites
  for select using (auth.uid() = user_id);

drop policy if exists wordpress_sites_insert_own on public.wordpress_sites;
create policy wordpress_sites_insert_own on public.wordpress_sites
  for insert with check (auth.uid() = user_id);

drop policy if exists wordpress_sites_update_own on public.wordpress_sites;
create policy wordpress_sites_update_own on public.wordpress_sites
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists wordpress_sites_delete_own on public.wordpress_sites;
create policy wordpress_sites_delete_own on public.wordpress_sites
  for delete using (auth.uid() = user_id);

-- ── blog_posts FK ─────────────────────────────────────────────────────────
-- Add a nullable FK from blog_posts to wordpress_sites. Nullable because:
--   - Legacy posts predate this column; we backfill below.
--   - Drafts that haven't been published yet have no target site.
-- The FK uses ON DELETE SET NULL so deleting a site doesn't cascade-delete
-- the posts it published — those are user content, the site just goes away.
alter table public.blog_posts
  add column if not exists wordpress_site_id uuid
  references public.wordpress_sites(id) on delete set null;

create index if not exists blog_posts_wordpress_site_id_idx
  on public.blog_posts (wordpress_site_id);

-- ── Backfill ──────────────────────────────────────────────────────────────
-- For every user with an existing WP connection in integrations, create a
-- single default site row that mirrors their current credentials. Idempotent —
-- ON CONFLICT does nothing if the user already has a row for this URL.
--
-- The "Main" label is generic-but-explicit so users see SOMETHING in the
-- picker; they can rename in Settings → Integrations.
insert into public.wordpress_sites (
  user_id, label, url, username, app_password, api_token,
  is_default, display_order
)
select
  user_id,
  'Main',
  wordpress_url,
  wordpress_username,
  wordpress_app_password,
  wordpress_api_token,
  true,   -- backfilled rows ARE the default site
  0
from public.integrations
where wordpress_url is not null
  and wordpress_username is not null
  and wordpress_app_password is not null
  -- Don't create a duplicate row if backfill is rerun.
  and not exists (
    select 1 from public.wordpress_sites
    where wordpress_sites.user_id = integrations.user_id
  );

-- Backfill blog_posts.wordpress_site_id by joining on user_id (legacy
-- single-site era: every user's posts went to their one site).
update public.blog_posts bp
set wordpress_site_id = ws.id
from public.wordpress_sites ws
where bp.user_id = ws.user_id
  and ws.is_default = true
  and bp.wordpress_site_id is null;

comment on table public.wordpress_sites is
  'Per-user WordPress sites. Pro supports up to 5; Creator/Studio at 1. '
  'Replaces the singular integrations.wordpress_* columns over Phase 3.';
