-- 127 — youtube_channels: per-user multi-channel (Pro feature)
--
-- Pro creators run more than one YouTube channel. This table holds a row per
-- connected channel so a user can:
--   1. Set a DEFAULT channel per WordPress site (which channel that blog
--      pulls videos from by default), and
--   2. Pull videos from a SECONDARY channel onto the same blog ad-hoc.
--
-- KEY ARCHITECTURE NOTE:
--   Reading/syncing a channel's uploads uses the public YOUTUBE_API_KEY +
--   the channel_id (the UC… id) — NO OAuth needed. So "pull from another
--   channel" only needs that channel's id stored here.
--   The OAuth tokens below are ONLY needed to PUSH metadata back to YouTube
--   (Co-Pilot apply / update-metadata / thumbnail) for channels the user
--   authorized. A channel can exist here with NULL tokens (pull-only).
--
-- Mirrors the wordpress_sites multi-site pattern (085): one default per user,
-- per-user cap enforced by trigger, RLS, legacy backfill from integrations.
-- BACKWARDS COMPAT: integrations.youtube_channel_id / youtube_oauth_* stay in
-- place until every route reads via lib/youtube-channels.ts. Reads fall back
-- to integrations when youtube_channels is empty for the user.

-- ── Table ──────────────────────────────────────────────────────────────────
create table if not exists public.youtube_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The YouTube channel id (UC…). This is what sync uses (with the API key)
  -- to pull the channel's uploads. Unique per user.
  channel_id text not null,
  -- Display name shown in the channel picker. Resolved on connect; falls back
  -- to the channel_id if the lookup failed.
  channel_title text,
  -- OAuth tokens for PUSH-BACK only (Co-Pilot writes title/desc/tags/thumb to
  -- YouTube). NULL when the channel was added pull-only (no authorization yet).
  -- Encrypted at rest (enc:v1:) — same maybeDecrypt path as integrations.
  oauth_access_token text,
  oauth_refresh_token text,
  oauth_token_expiry bigint,
  -- The user's primary channel. Exactly one row per user is_default = true
  -- (partial unique index below). Used as the fallback when a WP site has no
  -- explicit default channel set.
  is_default boolean not null default false,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel_id)
);

create unique index if not exists youtube_channels_one_default_per_user
  on public.youtube_channels (user_id) where is_default;

create index if not exists youtube_channels_user_id_idx
  on public.youtube_channels (user_id);

-- Per-user cap (10, matching the Pro WordPress-site cap). The lib-level
-- tier gate is the real UX limit; this is a hard safety net.
create or replace function public.enforce_youtube_channels_per_user_cap()
returns trigger as $$
begin
  if (select count(*) from public.youtube_channels where user_id = new.user_id) > 10 then
    raise exception 'Up to 10 YouTube channels per account';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists youtube_channels_cap_trigger on public.youtube_channels;
create trigger youtube_channels_cap_trigger
  after insert on public.youtube_channels
  for each row execute function public.enforce_youtube_channels_per_user_cap();

drop trigger if exists youtube_channels_touch_trigger on public.youtube_channels;
create trigger youtube_channels_touch_trigger
  before update on public.youtube_channels
  for each row execute function public.touch_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.youtube_channels enable row level security;

drop policy if exists youtube_channels_select_own on public.youtube_channels;
create policy youtube_channels_select_own on public.youtube_channels
  for select using (auth.uid() = user_id);

drop policy if exists youtube_channels_insert_own on public.youtube_channels;
create policy youtube_channels_insert_own on public.youtube_channels
  for insert with check (auth.uid() = user_id);

drop policy if exists youtube_channels_update_own on public.youtube_channels;
create policy youtube_channels_update_own on public.youtube_channels
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists youtube_channels_delete_own on public.youtube_channels;
create policy youtube_channels_delete_own on public.youtube_channels
  for delete using (auth.uid() = user_id);

-- ── Per-site default channel ────────────────────────────────────────────────
-- Which connected channel a given WordPress site pulls from by default. NULL =
-- use the user's default channel (youtube_channels.is_default). ON DELETE SET
-- NULL so removing a channel just reverts the site to its default.
alter table public.wordpress_sites
  add column if not exists default_youtube_channel_id uuid
  references public.youtube_channels(id) on delete set null;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Every user with a YouTube channel set in integrations gets a default
-- youtube_channels row mirroring their current connection (tokens included).
-- Idempotent — skip users who already have a row.
insert into public.youtube_channels (
  user_id, channel_id, channel_title,
  oauth_access_token, oauth_refresh_token, oauth_token_expiry,
  is_default, display_order
)
select
  user_id,
  youtube_channel_id,
  null,
  youtube_oauth_access_token,
  youtube_oauth_refresh_token,
  youtube_oauth_token_expiry,
  true,
  0
from public.integrations
where youtube_channel_id is not null
  and not exists (
    select 1 from public.youtube_channels
    where youtube_channels.user_id = integrations.user_id
  );

comment on table public.youtube_channels is
  'Per-user YouTube channels. Pro supports up to 10; others 1. Pulling uses '
  'channel_id + API key (no OAuth); oauth_* tokens are for Co-Pilot push-back '
  'only. wordpress_sites.default_youtube_channel_id maps a site to its channel.';
