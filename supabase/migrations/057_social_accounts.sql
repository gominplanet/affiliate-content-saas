-- 057 — social_accounts: multiple connected accounts per platform (Pro)
--
-- Today `integrations` holds ONE account per platform (one facebook_page_id,
-- one instagram_user_id, …). To let Pro users run several Facebook Pages /
-- Instagram accounts from one dashboard, we move connectable destinations into
-- a one-to-many table. Each row is one place a post can go.
--
-- Phase 1 covers Meta (facebook | instagram). Other platforms can be added as
-- rows later without schema changes. The legacy single columns on
-- `integrations` stay in place — post routes prefer social_accounts and fall
-- back to the legacy columns, so nothing breaks and no reconnect is required.

create table if not exists public.social_accounts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  /** 'facebook' | 'instagram' (Phase 1). Free-form so we can add platforms. */
  platform      text not null,
  /** The destination's native id: FB Page id, IG user id, etc. */
  external_id   text not null,
  /** What the user sees in the dropdown ("Gomin Reviews", "Pet Brand IG"). */
  display_name  text,
  /** 'page' (FB) | 'account' (IG) — sub-kind, for future destinations
   *  like Pinterest boards or Telegram channels. */
  kind          text not null default 'account',
  /** Per-account credential (FB Page access token, IG token, …). */
  access_token  text,
  /** Anything platform-specific, e.g. the FB Page id an IG account hangs off. */
  extra         jsonb not null default '{}'::jsonb,
  /** The account used when the user doesn't pick one explicitly. Exactly one
   *  per (user, platform) should be true — enforced in app code on write. */
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, platform, external_id)
);

create index if not exists social_accounts_user_platform_idx
  on public.social_accounts (user_id, platform);

alter table public.social_accounts enable row level security;

-- Owner-only RLS (matches the rest of the schema's per-user policies).
drop policy if exists "social_accounts_owner_all" on public.social_accounts;
create policy "social_accounts_owner_all" on public.social_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Backfill the currently-connected Meta accounts from `integrations` ───────
-- So existing users see their current Page / IG account in the new dropdown
-- immediately, marked as default. ON CONFLICT keeps re-runs idempotent.
insert into public.social_accounts (user_id, platform, external_id, display_name, kind, access_token, is_default)
select user_id, 'facebook', facebook_page_id,
       coalesce(facebook_page_name, 'Facebook Page'), 'page',
       facebook_page_access_token, true
  from public.integrations
 where facebook_page_id is not null
on conflict (user_id, platform, external_id) do nothing;

insert into public.social_accounts (user_id, platform, external_id, display_name, kind, access_token, is_default)
select user_id, 'instagram', instagram_user_id,
       coalesce(instagram_username, 'Instagram'), 'account',
       instagram_access_token, true
  from public.integrations
 where instagram_user_id is not null
on conflict (user_id, platform, external_id) do nothing;
