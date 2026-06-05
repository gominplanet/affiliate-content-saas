-- ════════════════════════════════════════════════════════════════════════════
-- RUN_RECENT_MIGRATIONS.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- Paste-and-run bundle: every migration from 080_audit_fixes onward in
-- one block. Safe to run as a whole even if some are already applied —
-- every statement uses `if not exists` / `or replace` / safe guards.
--
-- WHEN TO USE:
--   - "I haven't run anything in a while" → paste this whole file.
--   - "I lost track of which migrations are live" → paste this whole file.
--   - "Feature X said migration N is missing" → paste this whole file
--     (N is in here, plus everything else).
--
-- HOW:
--   1. Open Supabase → SQL Editor → New query.
--   2. Paste everything below.
--   3. Hit Run. Should finish in a few seconds.
--   4. If any statement errors, the rest still run (Postgres rolls back
--      just that statement). Re-run after fixing.
--
-- KEPT IN SYNC WITH:
--   supabase/migrations/080_audit_fixes.sql through 093_blog_posts_deal_meta.sql
--   Future migrations should be appended here in the same commit they land.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- 080_audit_fixes.sql
-- ════════════════════════════════════════════════════════════════
-- 080 — Audit pass: serialize quota check, atomic broadcast counters, rate-limit index
--
-- Three small structural changes surfaced by the 2026-05-29 code audit:
--
-- 1. try_consume_post_quota() — Postgres-side advisory-lock + count + decision
--    so two concurrent /api/blog/generate requests can't both pass the cap
--    check and both insert. Replaces the check-then-write pattern in
--    lib/tier.ts's checkUsageLimit. The route still calls .from('blog_posts')
--    .insert() afterwards — this just gates whether the insert is allowed.
--
-- 2. increment_broadcast_counter() — atomic UPDATE for newsletter_broadcasts
--    delivery counters. /api/newsletter/resend-webhook acknowledges in its
--    own comments that two concurrent 'delivered' events lose an increment;
--    Postgres-side UPDATE col = col + 1 fixes it without changing the
--    webhook handler shape.
--
-- 3. Partial index on newsletter_subscribers (signup_ip_hash, created_at)
--    so /api/newsletter/subscribe can rate-limit by source IP cheaply
--    (count signups in the last hour per ip-hash).
--
-- All three are forward-compatible — old callers keep working until the
-- routes are updated to call the new functions.

-- ── 1. Serialized post-quota gate ───────────────────────────────────────────
create or replace function public.try_consume_post_quota(
  p_user uuid,
  p_lifetime integer,          -- TIERS[tier].lifetimeMax, NULL = no lifetime cap
  p_monthly integer,           -- TIERS[tier].postsPerMonth, NULL = no monthly cap
  p_window_start timestamptz   -- billingWindow.startISO
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  cnt int;
begin
  -- Per-user advisory lock — held until the surrounding transaction ends.
  -- Two concurrent generates serialize through this point so the count
  -- they each see reflects all previously-committed inserts.
  perform pg_advisory_xact_lock(hashtext('post_quota:' || p_user::text));

  if p_lifetime is not null then
    select count(*) into cnt from public.blog_posts where user_id = p_user;
    return cnt < p_lifetime;
  end if;

  if p_monthly is not null then
    select count(*) into cnt
      from public.blog_posts
      where user_id = p_user and published_at >= p_window_start;
    return cnt < p_monthly;
  end if;

  -- No cap at all (admin tier) → always allow.
  return true;
end
$$;

revoke all on function public.try_consume_post_quota(uuid, integer, integer, timestamptz) from public;
grant execute on function public.try_consume_post_quota(uuid, integer, integer, timestamptz) to authenticated, service_role;

-- ── 2. Atomic broadcast counter increment ──────────────────────────────────
-- We allow-list the column name server-side BEFORE calling, but the function
-- still hard-checks so a misuse can't bump arbitrary columns.
create or replace function public.increment_broadcast_counter(
  p_broadcast_id uuid,
  p_user uuid,
  p_column text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_column not in (
    'recipients_delivered',
    'recipients_bounced',
    'recipients_opened',
    'recipients_clicked'
  ) then
    raise exception 'Invalid counter column: %', p_column;
  end if;

  execute format(
    'update public.newsletter_broadcasts set %I = coalesce(%I, 0) + 1 where id = $1 and user_id = $2',
    p_column, p_column
  ) using p_broadcast_id, p_user;
end
$$;

revoke all on function public.increment_broadcast_counter(uuid, uuid, text) from public;
grant execute on function public.increment_broadcast_counter(uuid, uuid, text) to authenticated, service_role;

-- ── 3. Rate-limit index for newsletter signup IP hashing ───────────────────
-- Used by /api/newsletter/subscribe to count signups per ip-hash in the
-- last hour without scanning the whole subscribers table.
create index if not exists newsletter_subscribers_iphash_recent_idx
  on public.newsletter_subscribers (signup_ip_hash, created_at desc)
  where signup_ip_hash is not null;


-- ════════════════════════════════════════════════════════════════
-- 081_tiktok_integration.sql
-- ════════════════════════════════════════════════════════════════
-- 081 — TikTok integration (Content Posting API + Login Kit)
--
-- MVP creators connect their TikTok account via TikTok's Login Kit (OAuth)
-- and we use the Content Posting API's Direct Post path to publish vertical
-- shorts on their behalf. Scopes: user.info.basic, video.upload,
-- video.publish.
--
-- Token shape:
--   * access token   — 24 hours
--   * refresh token  — 365 days (issued on the initial code exchange,
--     usable to mint a new access token without re-prompting the creator)
--
-- We track per-post publish state on blog_posts so the Content page can
-- show a "Posted to TikTok" pill + open-in-TikTok link once it's live.
-- TikTok takes minutes to process even after `init` returns 200; we surface
-- the polling state via `tiktok_publish_status` so the UI can show
-- "Processing" instead of pretending the post is live.

-- ── Creator OAuth tokens + identity ────────────────────────────────────────
alter table public.integrations
  -- Stable internal ID TikTok hands us once OAuth completes. Persists across
  -- token refreshes; use this to scope the post-history join in case the
  -- creator changes their @username.
  add column if not exists tiktok_open_id            text,
  -- Human-readable handle. Cached at OAuth-time and refreshed on each
  -- creator_info query so the dashboard never shows a stale @.
  add column if not exists tiktok_username           text,
  add column if not exists tiktok_display_name       text,
  add column if not exists tiktok_avatar_url         text,
  add column if not exists tiktok_access_token       text,
  add column if not exists tiktok_refresh_token      text,
  -- Epoch millis. We refresh 60s before expiry to avoid a race where the
  -- API call goes out with a token that's *just* expired.
  add column if not exists tiktok_token_expiry       bigint,
  -- When the refresh token itself expires (365 days from connect). After
  -- this the creator has to reconnect — we surface a banner in advance.
  add column if not exists tiktok_refresh_expiry     bigint,
  -- Which scopes the creator actually granted. Cached so the publish route
  -- can fail fast with "reconnect to grant video.publish" instead of a
  -- vague 403 from TikTok's API.
  add column if not exists tiktok_scopes             text;

-- ── Per-post publish tracking ──────────────────────────────────────────────
alter table public.blog_posts
  -- `publish_id` returned by /v2/post/publish/video/init. Used to poll the
  -- /status/fetch endpoint until TikTok finishes processing the video.
  add column if not exists tiktok_publish_id         text,
  -- 'processing' | 'published' | 'failed'. Mirrors TikTok's status with
  -- a small allowlist — the raw status strings (PROCESSING_UPLOAD,
  -- PUBLISH_COMPLETE, etc.) are useful for debugging but we only render
  -- these three to the dashboard.
  add column if not exists tiktok_publish_status     text,
  -- The public TikTok URL once the video is live. Null while processing.
  add column if not exists tiktok_share_url          text,
  -- Last-error message from TikTok when the publish fails (e.g. duration
  -- too long, watermark detected, account suspended). Surfaced to the
  -- creator in the dashboard so they don't have to guess.
  add column if not exists tiktok_error_message      text,
  -- Stamped when we get the first PUBLISH_COMPLETE poll. Used for the
  -- "Posted X min ago" pill on the Content page.
  add column if not exists tiktok_posted_at          timestamptz;

-- Newest-published lookup for the "Recent TikTok posts" section on the
-- dashboard. Tiny index — only matters when the dashboard surfaces a
-- "what's been pushed to TikTok this week" widget later.
create index if not exists blog_posts_tiktok_posted_idx
  on public.blog_posts (user_id, tiktok_posted_at desc)
  where tiktok_posted_at is not null;


-- ════════════════════════════════════════════════════════════════
-- 082_youtube_videos_tiktok.sql
-- ════════════════════════════════════════════════════════════════
-- 082 — Direct-push TikTok tracking on youtube_videos
--
-- Vertical Videos tab posts straight to TikTok (and Instagram) without
-- first generating a blog_post. For that, we need the same publish-state
-- columns we added on blog_posts (migration 081) directly on
-- youtube_videos so each Short carries its own TikTok history.
--
-- Mirrors blog_posts.tiktok_* shape exactly so the publish route can
-- treat both targets uniformly — just switch which table to read/write.

alter table public.youtube_videos
  add column if not exists tiktok_publish_id     text,
  add column if not exists tiktok_publish_status text,
  add column if not exists tiktok_share_url      text,
  add column if not exists tiktok_error_message  text,
  add column if not exists tiktok_posted_at      timestamptz;

-- Fast lookup for the "recently posted to TikTok" widget on the
-- dashboard / vertical tab strip.
create index if not exists youtube_videos_tiktok_posted_idx
  on public.youtube_videos (user_id, tiktok_posted_at desc)
  where tiktok_posted_at is not null;


-- ════════════════════════════════════════════════════════════════
-- 083_youtube_videos_ig_direct.sql
-- ════════════════════════════════════════════════════════════════
-- 083 — Direct-push Instagram tracking on youtube_videos
--
-- Mirrors migration 081/082 (TikTok) for Instagram. Lets the Vertical
-- Videos tab post straight from a Short to IG Reels (and optionally
-- Stories) WITHOUT first generating a blog post — the YT video carries
-- its own IG publish history.
--
-- Column names match blog_posts.instagram_reel_id / instagram_story_id
-- so the IG service can treat both targets uniformly.

alter table public.youtube_videos
  -- IG Reel container id once the publish completes. Null while
  -- processing (IG takes ~30-60s) or if Reel wasn't published.
  add column if not exists instagram_reel_id   text,
  -- IG Story container id. Story + Reel can both be posted from the
  -- same direct push; one column tracks each.
  add column if not exists instagram_story_id  text,
  -- Stamped when the FIRST IG push (Reel or Story) completes. Powers
  -- the "Posted to IG" pill state on the row.
  add column if not exists instagram_posted_at timestamptz;

-- Fast lookup for the "recently posted to IG" widget on the dashboard.
create index if not exists youtube_videos_instagram_posted_idx
  on public.youtube_videos (user_id, instagram_posted_at desc)
  where instagram_posted_at is not null;


-- ════════════════════════════════════════════════════════════════
-- 084_creator_connections_catalog.sql
-- ════════════════════════════════════════════════════════════════
-- 084_creator_connections_catalog.sql
-- Shared Amazon Creator Connections catalog. Admin uploads the weekly
-- export .zip; this table holds the parsed result. All authenticated
-- users can read; only admin (via service-role) can write.
--
-- Replaces the per-user client-side .zip upload on the Creator Campaigns
-- page — users now query a centralized catalog the admin refreshes weekly,
-- so they don't each have to know where the Amazon export lives.

create table if not exists public.creator_connections_catalog (
  id uuid primary key default gen_random_uuid(),
  asin text not null,
  campaign_id text not null,
  campaign_name text,
  brand text,
  commission numeric,
  ends_at date,
  days_left integer,
  budget_remain numeric default 0,
  slots_available numeric default 0,
  has_budget_and_slots boolean default false,
  imported_at timestamptz default now()
);
-- Note: we previously had a `raw_row jsonb` column here to preserve every
-- Amazon CSV column. Removed because (a) it was never read by any code
-- path and (b) it bloated the table by 1-2 GB on a 470k-row weekly export.
-- All fields the search route actually uses are extracted into typed
-- columns above.

create unique index if not exists creator_connections_catalog_unq
  on public.creator_connections_catalog (campaign_id, asin);
create index if not exists creator_connections_catalog_commission_idx
  on public.creator_connections_catalog (commission desc);
create index if not exists creator_connections_catalog_days_idx
  on public.creator_connections_catalog (days_left);
create index if not exists creator_connections_catalog_brand_idx
  on public.creator_connections_catalog (lower(brand));
create index if not exists creator_connections_catalog_budget_idx
  on public.creator_connections_catalog (has_budget_and_slots);
create index if not exists creator_connections_catalog_imported_idx
  on public.creator_connections_catalog (imported_at desc);
-- pg_trgm GIN indexes so the user-facing keyword search (ILIKE) can use
-- an index instead of full-scanning 470k rows. Without these the search
-- route times out on any non-trivial dataset. Trigram indexes are faster
-- to maintain on bulk insert than tsvector GIN, so worth the upfront cost.
create extension if not exists pg_trgm;
create index if not exists creator_connections_catalog_name_trgm_idx
  on public.creator_connections_catalog
  using gin (campaign_name gin_trgm_ops);
create index if not exists creator_connections_catalog_brand_trgm_idx
  on public.creator_connections_catalog
  using gin (brand gin_trgm_ops);

-- Search RPC function. Centralizes the catalog search logic in Postgres
-- so the query planner sees one deterministic query (instead of whatever
-- PostgREST cobbles together from chained .or() calls) and can pick the
-- right indexes consistently.
--
-- Used by /api/campaigns/catalog/search via supabase.rpc().
-- plpgsql with IF/ELSE so the planner can build TWO separate query plans —
-- one for "keyword present" (starts with the trigram index) and one for
-- "no keyword" (starts with the commission b-tree). DISTINCT ON dedupes
-- by ASIN inside the function so the route doesn't have to overfetch
-- (overfetch=2000 was crossing the statement timeout).
create or replace function public.search_creator_campaigns(
  p_keyword text,
  p_min_commission numeric,
  p_min_days integer,
  p_need_budget boolean,
  p_limit integer
)
returns table (
  asin text,
  campaign_id text,
  campaign_name text,
  brand text,
  commission numeric,
  ends_at date,
  days_left integer
)
language plpgsql
stable
as $$
begin
  if p_keyword is null or p_keyword = '' then
    return query
    select d.asin, d.campaign_id, d.campaign_name, d.brand, d.commission, d.ends_at, d.days_left
      from (
        select distinct on (c.asin) c.asin, c.campaign_id, c.campaign_name, c.brand,
               c.commission, c.ends_at, c.days_left
          from public.creator_connections_catalog c
         where c.commission >= coalesce(p_min_commission, 0)
           and (c.days_left is null or c.days_left >= coalesce(p_min_days, 0))
           and (not coalesce(p_need_budget, false) or c.has_budget_and_slots = true)
         order by c.asin, c.commission desc nulls last
      ) d
     order by d.commission desc nulls last
     limit greatest(coalesce(p_limit, 500), 1);
  else
    return query
    select d.asin, d.campaign_id, d.campaign_name, d.brand, d.commission, d.ends_at, d.days_left
      from (
        select distinct on (c.asin) c.asin, c.campaign_id, c.campaign_name, c.brand,
               c.commission, c.ends_at, c.days_left
          from public.creator_connections_catalog c
         where (c.campaign_name ilike '%' || p_keyword || '%' or c.brand ilike '%' || p_keyword || '%')
           and c.commission >= coalesce(p_min_commission, 0)
           and (c.days_left is null or c.days_left >= coalesce(p_min_days, 0))
           and (not coalesce(p_need_budget, false) or c.has_budget_and_slots = true)
         order by c.asin, c.commission desc nulls last
      ) d
     order by d.commission desc nulls last
     limit greatest(coalesce(p_limit, 500), 1);
  end if;
end;
$$;
grant execute on function public.search_creator_campaigns(text, numeric, integer, boolean, integer) to authenticated;

alter table public.creator_connections_catalog enable row level security;
create policy "Authenticated read" on public.creator_connections_catalog
  for select using (auth.uid() is not null);
-- No INSERT/UPDATE/DELETE policies: those go through service-role only,
-- gated by tier='admin' check in /api/admin/creator-campaigns/import.


-- ════════════════════════════════════════════════════════════════
-- 085_wordpress_sites.sql
-- ════════════════════════════════════════════════════════════════
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


-- ════════════════════════════════════════════════════════════════
-- 086_stripe_webhook_events.sql
-- ════════════════════════════════════════════════════════════════
-- Stripe webhook idempotency
--
-- Background: tonight's 2026-06-02 audit flagged that the Stripe webhook
-- route has no event-id dedup. Stripe retries every webhook on 5xx, and
-- the dashboard lets you replay manually. Without dedup, a replayed
-- `customer.subscription.deleted` (or any other event) could cause
-- duplicate downgrades, double-charges, or out-of-order tier flips.
--
-- Fix: a tiny table that records every event.id we've successfully
-- processed. The webhook checks this BEFORE doing any work — if the
-- event_id is already there, return 200 immediately and skip.
--
-- Why a regular table and not just an upsert + check: an UPSERT
-- doesn't tell us "was this row new?" without a RETURNING clause, and
-- it'd race with concurrent retries (Stripe sometimes fires the same
-- webhook to multiple endpoints simultaneously during a brief network
-- partition). With INSERT ... ON CONFLICT DO NOTHING + a RETURNING
-- check, we get atomic "did we win the race?" semantics.
--
-- Retention: 30 days. Stripe's webhook retry window is up to 3 days
-- for any single event, so 30 covers replays + manual dashboard
-- replays comfortably. A simple cleanup query (left for ops to run
-- via cron when needed) drops rows older than 30 days.

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  -- Stripe's event id (evt_xxxxxxxxxxxxxxxxxxxxxxxx). Primary key
  -- gives us the dedup gate for free + the natural index on lookups.
  event_id    text PRIMARY KEY,

  -- Event type for telemetry / debugging (customer.subscription.deleted,
  -- checkout.session.completed, etc). Indexed for quick "show me all
  -- replayed deletes" queries during incident review.
  event_type  text NOT NULL,

  -- When we recorded the event. Used for the 30-day cleanup sweep.
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_created_at
  ON stripe_webhook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_type
  ON stripe_webhook_events (event_type);

-- RLS: the table is only ever touched by the service-role webhook
-- route. Enable RLS with no policies so RLS-scoped client reads return
-- empty (safest default if anyone accidentally exposes it later).
ALTER TABLE stripe_webhook_events ENABLE ROW LEVEL SECURITY;

-- Optional cleanup (run via cron when convenient — not auto-scheduled):
--   DELETE FROM stripe_webhook_events WHERE created_at < now() - interval '30 days';


-- ════════════════════════════════════════════════════════════════
-- 087_api_keys.sql
-- ════════════════════════════════════════════════════════════════
-- Migration 087 — API keys for Pro-tier programmatic access.
--
-- Each Pro user can mint multiple API keys (label them per integration: "Zapier",
-- "internal automation", "n8n", etc.). The plaintext key is shown ONCE on creation
-- and never stored — we only persist a SHA-256 hash. Bearer-token auth on
-- /api/v1/* routes hashes the incoming token and looks it up here.
--
-- Format: `mvp_live_<32 random url-safe chars>` (shows source app + obvious to
-- spot in logs/leaks). `key_prefix` is the first ~10 chars so the UI can show
-- a "key-ish" identifier without revealing the secret.

CREATE TABLE IF NOT EXISTS api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Human-readable name set by the user when minting the key ("Zapier", etc.)
  name          text NOT NULL CHECK (length(name) >= 1 AND length(name) <= 80),
  -- SHA-256 of the plaintext key. The plaintext is shown once at creation.
  -- Indexed (unique) so the auth middleware can do a single point lookup.
  key_hash      text NOT NULL UNIQUE,
  -- The first ~10 chars of the plaintext (e.g. "mvp_live_abc"). Lets the UI
  -- show "Key ending in xxxx" / "Key starting with mvp_live_ab..." without
  -- exposing the secret, AND lets us match logs that only have the prefix.
  key_prefix    text NOT NULL,
  -- Updated on every successful authenticated request through this key.
  -- Lets the user see "last used 2 hours ago" in the settings UI and
  -- detect dormant integrations to clean up.
  last_used_at  timestamptz,
  -- Set when the user revokes the key. We KEEP the row so the user can
  -- audit which keys were active when. Revoked keys can no longer
  -- authenticate (the auth middleware filters by revoked_at IS NULL).
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);
-- Used by the auth middleware to scan ONLY active keys (revoked ones can't auth).
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys (key_hash) WHERE revoked_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Users can only see / mint / revoke their own keys. The auth middleware
-- uses the admin client (bypass RLS) for the lookup step since the
-- incoming request hasn't been authenticated yet at that point.
CREATE POLICY "api_keys self-read" ON api_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "api_keys self-insert" ON api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "api_keys self-update" ON api_keys
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "api_keys self-delete" ON api_keys
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE api_keys IS
  'Pro-tier programmatic access. Plaintext shown once at creation; only the SHA-256 hash is persisted. Used by /api/v1/* Bearer auth.';


-- ════════════════════════════════════════════════════════════════
-- 088_whitelabel.sql
-- ════════════════════════════════════════════════════════════════
-- Migration 088 — White-label branding columns on integrations.
--
-- Pro users can override the dashboard branding with their own logo + accent
-- colour + brand name. Reads happen on every dashboard page render, so this
-- HAS to be a column on `integrations` (which is already loaded on every
-- authenticated page) rather than a separate table — keeps the read path
-- to zero extra queries.
--
-- Columns are nullable. NULL on any of them means "use the default MVP
-- Affiliate branding for that piece". A user can set just a colour, just
-- a logo, or all three.

ALTER TABLE integrations
  ADD COLUMN IF NOT EXISTS whitelabel_logo_url text,
  ADD COLUMN IF NOT EXISTS whitelabel_brand_name text,
  ADD COLUMN IF NOT EXISTS whitelabel_accent_color text;

-- Soft constraints — checked at the DB so a future direct INSERT (e.g. via
-- a migration helper or admin update) can't ship malformed data either.
-- Accent must be a 7-char #hex (no shorthand like #abc — Satori / Tailwind
-- both want 6-char forms). Brand name is short and bounded.
ALTER TABLE integrations
  ADD CONSTRAINT whitelabel_accent_format
    CHECK (whitelabel_accent_color IS NULL OR whitelabel_accent_color ~* '^#[0-9a-f]{6}$');

ALTER TABLE integrations
  ADD CONSTRAINT whitelabel_brand_name_len
    CHECK (whitelabel_brand_name IS NULL OR (length(whitelabel_brand_name) >= 1 AND length(whitelabel_brand_name) <= 40));

COMMENT ON COLUMN integrations.whitelabel_logo_url IS
  'Pro-only. Logo URL shown in the sidebar + dashboard header in place of the MVP Affiliate logo. NULL = use the default.';
COMMENT ON COLUMN integrations.whitelabel_brand_name IS
  'Pro-only. Brand name shown in the sidebar + browser tab title. NULL = "MVP Affiliate".';
COMMENT ON COLUMN integrations.whitelabel_accent_color IS
  'Pro-only. Accent hex colour applied to primary buttons + links. NULL = #7C3AED (default purple). Must be 7-char hex.';


-- ════════════════════════════════════════════════════════════════
-- 089_agency_seats.sql
-- ════════════════════════════════════════════════════════════════
-- Migration 089 — Agency seats: multi-user accounts under one Pro subscription.
--
-- Phase 1 (this migration): data model + invite flow.
--   - agency_invites: pending email invitations from owner → invitee
--   - agency_members: accepted memberships linking owner ↔ member
--
-- Phase 2 (future): resource-sharing override. Every route that filters by
-- user_id needs to resolve "effective owner" so a member sees the parent
-- account's content. The data model is built now so Phase 2 is a pure
-- query change — no schema migration needed.

-- ── Invites: a row exists from the moment the owner sends the invite
--            until the invitee accepts (→ migrate to agency_members) or
--            it expires (TTL 14 days, enforced in app layer for now).
CREATE TABLE IF NOT EXISTS agency_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Pro user who minted the invite.
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Email the invite was sent to. We rely on email match at accept time,
  -- not auth.users.email lookup, so the invitee can sign up with the
  -- exact email used in the invite even if they have no MVP account yet.
  email         text NOT NULL,
  -- The single-use token embedded in the accept link. SHA-256 hashed at
  -- rest so an invite-link leak doesn't expose every other pending invite.
  -- The plaintext is shown ONCE in the email body; we never store it.
  token_hash    text NOT NULL UNIQUE,
  -- Owner-chosen role for the seat: admin = full access (manage other
  -- members + billing), member = create content but not manage seats.
  -- More roles can be added later (analyst-only, write-only, etc.).
  role          text NOT NULL CHECK (role IN ('admin', 'member')) DEFAULT 'member',
  -- Friendly note shown in the invite email + UI ("welcome aboard Sarah!").
  note          text CHECK (note IS NULL OR length(note) <= 280),
  -- Stamped on accept/decline. Pending invite has both NULL.
  accepted_at   timestamptz,
  declined_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Compound uniqueness: prevents an owner from spamming the same email
  -- with duplicate pending invites. We allow re-invite after decline by
  -- including declined_at in the unique index.
  UNIQUE (owner_user_id, email, declined_at)
);

CREATE INDEX IF NOT EXISTS idx_agency_invites_owner ON agency_invites (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_agency_invites_email ON agency_invites (lower(email));
-- The accept route does a single point lookup by token_hash.
CREATE INDEX IF NOT EXISTS idx_agency_invites_active_token ON agency_invites (token_hash)
  WHERE accepted_at IS NULL AND declined_at IS NULL;

ALTER TABLE agency_invites ENABLE ROW LEVEL SECURITY;

-- Owners read/write their own invites. The accept route uses the admin
-- client (bypass RLS) because the invitee may not have a Supabase session
-- yet at accept time.
CREATE POLICY "agency_invites owner-read" ON agency_invites
  FOR SELECT USING (auth.uid() = owner_user_id);
CREATE POLICY "agency_invites owner-insert" ON agency_invites
  FOR INSERT WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "agency_invites owner-update" ON agency_invites
  FOR UPDATE USING (auth.uid() = owner_user_id);
CREATE POLICY "agency_invites owner-delete" ON agency_invites
  FOR DELETE USING (auth.uid() = owner_user_id);


-- ── Memberships: accepted seats. One row per (owner, member) pair.
CREATE TABLE IF NOT EXISTS agency_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The Pro account owning the seat.
  owner_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The member who accepted. CASCADE-deleted if the member's auth row
  -- ever goes away.
  member_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Inherited from the invite at accept time.
  role            text NOT NULL CHECK (role IN ('admin', 'member')) DEFAULT 'member',
  -- Set when the owner revokes the seat. Revoked members keep their auth
  -- row (so they can still log in to other workspaces in the future) but
  -- lose access to the owner's resources. We keep the row for the audit
  -- trail.
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- A user can only be a member of one agency at a time. Trying to accept
  -- a second invite while already part of an agency fails at the app layer.
  UNIQUE (member_user_id)
);

CREATE INDEX IF NOT EXISTS idx_agency_members_owner ON agency_members (owner_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agency_members_member ON agency_members (member_user_id) WHERE revoked_at IS NULL;

ALTER TABLE agency_members ENABLE ROW LEVEL SECURITY;

-- Owners read all their members; members read only their own row.
-- (Both will eventually call getOwnerUserId() to know whose data to show.)
CREATE POLICY "agency_members owner-read" ON agency_members
  FOR SELECT USING (auth.uid() = owner_user_id OR auth.uid() = member_user_id);
-- Only the owner can revoke (UPDATE revoked_at). Member can't unilaterally
-- "leave" via this table — they'd contact support or delete their auth row.
CREATE POLICY "agency_members owner-update" ON agency_members
  FOR UPDATE USING (auth.uid() = owner_user_id);
-- Inserts come from the accept route (admin client, bypass RLS).

COMMENT ON TABLE agency_invites IS
  'Pending agency seat invitations. Owner mints → email sent → invitee clicks → row migrates to agency_members.';
COMMENT ON TABLE agency_members IS
  'Accepted agency seats. Phase 2 will resolve effective owner for resource queries via lib/agency.ts:getOwnerUserId.';


-- ════════════════════════════════════════════════════════════════
-- 090_newsletter_ab_schedule_segments.sql
-- ════════════════════════════════════════════════════════════════
-- 090 — Newsletter: A/B subjects, scheduling, segments
--
-- Three additive features on top of the existing newsletter pipeline (074).
-- All changes are additive — no existing column is dropped or renamed; old
-- broadcasts keep working unchanged.
--
-- ──────────────────────────────────────────────────────────────────────────
-- 1. A/B subject lines on broadcasts
-- ──────────────────────────────────────────────────────────────────────────
--
-- Workflow:
--   1. Compose-time the user types Subject A + optional Subject B + a sample
--      pct (default 20%). The remaining 80% gets the winning subject after
--      the test settles.
--   2. /api/newsletter/send detects subject_b + ab_sample_pct, randomly
--      partitions sample_pct of recipients into half-A / half-B, sends them
--      RIGHT NOW with the corresponding subject, tags every email with
--      kind=newsletter_broadcast + broadcast_id + variant=a|b. Status flips
--      to 'ab_testing'. ab_finalize_at is set to now() + ab_test_hours h.
--   3. /api/cron/newsletter-process (Vercel cron, every minute) finds rows
--      where status='ab_testing' AND ab_finalize_at <= now(); reads
--      ab_opens_a vs ab_opens_b; picks the winner; sends the winning
--      subject to the remaining (100 - sample_pct)% of recipients; status
--      flips to 'sent'.
--   4. Resend webhook (resend-webhook/route.ts) reads the variant tag and
--      ticks ab_opens_a OR ab_opens_b per open event.
--
-- We snapshot which recipient IDs got which variant so the webhook can
-- attribute correctly even if subscribers churn between the test send and
-- the open events arriving.
alter table public.newsletter_broadcasts
  add column if not exists subject_b text,
  add column if not exists ab_sample_pct integer,
  add column if not exists ab_test_hours integer,
  add column if not exists ab_finalize_at timestamptz,
  add column if not exists ab_finalized_at timestamptz,
  add column if not exists ab_winner_variant text,             -- 'a' | 'b' | null
  add column if not exists ab_recipients_a uuid[] not null default '{}',
  add column if not exists ab_recipients_b uuid[] not null default '{}',
  add column if not exists ab_opens_a integer not null default 0,
  add column if not exists ab_opens_b integer not null default 0,
  -- Granular compose-time fields. Existing broadcasts only have the rendered
  -- HTML; for A/B winner-send + scheduled-send the cron needs to re-render
  -- from the structured inputs (per-recipient unsub URL must be rebuilt).
  add column if not exists compose_intro text,
  add column if not exists compose_outro text;

-- Status path now also includes 'scheduled' (queued for future send) and
-- 'ab_testing' (sample sent, awaiting winner finalization). Existing values
-- ('draft' | 'sending' | 'sent' | 'failed') are unchanged.

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Scheduling
-- ──────────────────────────────────────────────────────────────────────────
--
-- scheduled_at already exists from migration 074. The send route accepts
-- a scheduled_at param: when present and in the future, the row goes in
-- with status='scheduled' and recipients_total snapshotted but no emails
-- are sent. The cron processor picks it up at the scheduled time.

-- Index for the cron to pick scheduled rows efficiently (small table, but
-- worth doing — the cron runs every minute).
create index if not exists newsletter_broadcasts_scheduled_idx
  on public.newsletter_broadcasts (status, scheduled_at)
  where status in ('scheduled', 'ab_testing');

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Segmented sends
-- ──────────────────────────────────────────────────────────────────────────
--
-- segment_filter JSONB on broadcasts narrows the recipient list at send
-- time. Schema:
--   {
--     source?:        'blog_form' | 'csv_import' | 'manual',
--     signedUpAfter?: ISO timestamp,
--     signedUpBefore?: ISO timestamp,
--     tags?:          string[]      // ANY-of match against subscriber.tags
--   }
-- All filters AND together. A null/empty segment_filter means "send to all
-- active subscribers" (the historical behaviour, preserved).
alter table public.newsletter_broadcasts
  add column if not exists segment_filter jsonb;

-- Per-subscriber tag column for segmentation. Free-text labels the creator
-- applies (e.g. 'paying', 'lead', 'archived'). Default empty array.
alter table public.newsletter_subscribers
  add column if not exists tags text[] not null default '{}';

-- GIN index so segment_filter.tags lookups (subscribers where tags && filter.tags)
-- stay fast even at 50k+ subscribers.
create index if not exists newsletter_subscribers_tags_gin
  on public.newsletter_subscribers using gin (tags);

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Extend the broadcast-counter RPC to allow ab_opens_a + ab_opens_b
-- ──────────────────────────────────────────────────────────────────────────
--
-- The original 080 allowlist only knew the four overall recipient counters.
-- The Resend webhook now also bumps the per-variant open counters when the
-- email it processes was tagged with a variant. Re-creating the function
-- is safe — same signature, broader allowlist.
create or replace function public.increment_broadcast_counter(
  p_broadcast_id uuid,
  p_user uuid,
  p_column text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_column not in (
    'recipients_delivered',
    'recipients_bounced',
    'recipients_opened',
    'recipients_clicked',
    'ab_opens_a',
    'ab_opens_b'
  ) then
    raise exception 'Invalid counter column: %', p_column;
  end if;

  execute format(
    'update public.newsletter_broadcasts set %I = coalesce(%I, 0) + 1 where id = $1 and user_id = $2',
    p_column, p_column
  ) using p_broadcast_id, p_user;
end
$$;


-- ════════════════════════════════════════════════════════════════
-- 091_blog_quality_checks.sql
-- ════════════════════════════════════════════════════════════════
-- 091 — Blog-writer quality telemetry
--
-- The blog-writer audit (June 2026) produced a 9-rule hardening pass:
-- tic ban-list, H2 heading variety, ≥3 concrete numbers, lived-experience
-- negatives, FAQ uniqueness, conditional comparison, post-gen self-check,
-- opening hook, and a residual-leak sweep. After all that work we still
-- only knew if it was working by eyeballing individual posts.
--
-- This table captures the self-check pass's output per generated post so
-- /admin/blog-quality can show:
--   - Trend: average violations per post over last 30 / 90 days
--   - Pattern frequency: which tics still leak the most
--   - Numbers gap: which posts ship with fewer than 3 product specs
--   - Per-post drill-down: for a flagged post, what fired
--
-- One row per blog-generation that ran the self-check. Insert happens at
-- the end of /api/blog/generate (after the WP publish + blog_posts row
-- so we can FK back). Best-effort write — a failed insert here never
-- blocks the article from publishing.

create table if not exists public.blog_quality_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Optional link to the blog_posts row this check was for. Nullable
  -- because the insert order in /api/blog/generate is: generate content →
  -- run self-check → publish to WP → insert blog_posts row. We record
  -- the check BEFORE blog_posts exists so a publish failure doesn't lose
  -- the telemetry. A nightly job (or the next generation on the same
  -- video) can backfill this column once the blog_posts row exists.
  blog_post_id uuid references public.blog_posts(id) on delete set null,
  -- The video this post was generated from. Always present (we know it
  -- before we ever call Claude) and useful for grouping checks per
  -- video on the dashboard.
  video_id uuid references public.youtube_videos(id) on delete cascade,
  -- Total violations Haiku flagged in the self-check pass.
  violations_found integer not null default 0,
  -- Subset of violations that actually landed via string-replace.
  -- violations_found - fixes_applied = paraphrase-miss count (Haiku
  -- returned a violation but the `original` didn't match verbatim).
  fixes_applied integer not null default 0,
  -- Product-specific concrete numbers counted in the final body.
  -- RULE 11 target is ≥3.
  numbers_detected integer not null default 0,
  -- Array of violation pattern labels that fired (e.g. ['ai-emphasis-defense',
  -- 'em-dash heading']). Used by the dashboard's "top leaking patterns" view.
  violation_patterns text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.blog_quality_checks enable row level security;
-- Users see their own checks. Admin sees all via the admin-client
-- read in the dashboard route.
drop policy if exists "Users see own blog quality checks" on public.blog_quality_checks;
create policy "Users see own blog quality checks" on public.blog_quality_checks
  for select using (auth.uid() = user_id);
-- Inserts come from the route running with the service-role client
-- (createAdminClient) since auth.uid() isn't set in cron / server-only
-- contexts. No insert policy needed for user-context inserts.

-- Index for the dashboard's date-range scans + per-user filter.
create index if not exists blog_quality_checks_user_created_idx
  on public.blog_quality_checks (user_id, created_at desc);

-- Pattern-frequency aggregation index (GIN on the patterns array).
-- Lets the dashboard count "how many posts had pattern X" without
-- scanning every row.
create index if not exists blog_quality_checks_patterns_gin
  on public.blog_quality_checks using gin (violation_patterns);

-- Numbers-under-threshold index for the "posts that need more specs" view.
create index if not exists blog_quality_checks_low_numbers_idx
  on public.blog_quality_checks (user_id, created_at desc)
  where numbers_detected < 3;


-- ════════════════════════════════════════════════════════════════
-- 092_virtual_assistant_permissions.sql
-- ════════════════════════════════════════════════════════════════
-- 092 — Virtual Assistant permissions on agency invites + members
--
-- Phase 1 (migration 089) shipped invites + roster with two roles:
-- 'admin' and 'member'. Both roles got the same broad access — fine for
-- a trusted in-house teammate, too much for an outsourced VA the user
-- wants doing a specific task (e.g. only generating posts, only
-- publishing to socials).
--
-- This migration adds granular permission flags so the owner can
-- create scoped VAs while keeping the role concept for the few things
-- it still controls (admin = can manage other VAs; member = can't).
--
-- The blocked-for-VAs surfaces (blog customization, integrations, WP
-- settings, brand profile, billing) are enforced at the route layer
-- via hasPermission() / BLOCKED_FOR_VAS — there's no per-VA flag for
-- those because they're never legitimate VA work.
--
-- Permission schema (JSONB):
--   {
--     "generate_posts":         bool,   -- can use /content + /api/blog/generate
--     "publish_to_socials":     bool,   -- can post to FB/IG/TikTok/Threads/X/Pinterest
--     "manage_newsletter":      bool,   -- can compose + send newsletters
--     "youtube_copilot":        bool,   -- can generate YT metadata + thumbnails
--     "manage_videos":          bool,   -- can add/remove videos from the library
--     "view_analytics":         bool    -- can see Analytics + SEO + content insights
--   }
--
-- All flags default to true on existing members (preserve current behavior)
-- and to a sensible "content VA" preset on new invites.

alter table public.agency_invites
  add column if not exists permissions jsonb not null default jsonb_build_object(
    'generate_posts',     true,
    'publish_to_socials', true,
    'manage_newsletter',  false,
    'youtube_copilot',    true,
    'manage_videos',      true,
    'view_analytics',     false
  );

alter table public.agency_members
  add column if not exists permissions jsonb not null default jsonb_build_object(
    'generate_posts',     true,
    'publish_to_socials', true,
    'manage_newsletter',  true,
    'youtube_copilot',    true,
    'manage_videos',      true,
    'view_analytics',     true
  );

-- Backfill: any existing accepted members get the full permission set
-- (matches the pre-permissions behavior where every member had broad
-- access). Owners can downscope from the UI afterwards.
update public.agency_members
set permissions = jsonb_build_object(
    'generate_posts',     true,
    'publish_to_socials', true,
    'manage_newsletter',  true,
    'youtube_copilot',    true,
    'manage_videos',      true,
    'view_analytics',     true
  )
where permissions is null or permissions = '{}'::jsonb;


-- ════════════════════════════════════════════════════════════════
-- 093_blog_posts_deal_meta.sql
-- ════════════════════════════════════════════════════════════════
-- Migration 093: blog_posts.deal_meta JSONB column
--
-- Powers the new Deals Hub (post_type='deal'). Holds the structured deal
-- envelope: asin, prices (was/sale), discount percent, deal badge text, end
-- date, occasion slug, promo code, promo URL, plus the rendered badge label
-- and the savings line we computed for the article body.
--
-- JSONB chosen over per-column columns because:
--   1. Schema is deal-specific — bloating blog_posts with 10+ NULL columns
--      that only deal rows ever populate is noisy.
--   2. JSONB lets the WP plugin's [mvp_deal_banner] shortcode read whatever
--      structured fields we end up needing without another migration.
--   3. The API route always reads the whole object together, never queries
--      by individual fields.
--
-- Indexed only on a single GIN to keep writes cheap; the Deals Hub list query
-- filters by user_id + post_type='deal' which already hits the primary
-- composite index from migration 068.

alter table public.blog_posts
  add column if not exists deal_meta jsonb;

comment on column public.blog_posts.deal_meta is
  'Structured deal envelope for post_type=''deal'' rows (Deals Hub). NULL for review/comparison/guide rows.';

-- Light GIN index so future analytics queries (e.g. "all Black Friday deals
-- ending this week") stay fast. The deals UI itself doesn't need this.
create index if not exists blog_posts_deal_meta_gin
  on public.blog_posts using gin (deal_meta)
  where deal_meta is not null;


