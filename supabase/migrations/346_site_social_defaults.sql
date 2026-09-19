-- 346 — site_social_defaults: which social account each SITE posts to.
--
-- social_accounts is keyed on (user, platform), and is_default picks one row
-- per pair. That is the right model for a creator with one blog. A creator with
-- several has one Facebook page per site and no way to say so: every post from
-- every site resolves to the same default, so the wrong audience gets it.
--
-- blog_posts.wordpress_site_id has always existed and is what picks the
-- WordPress credentials to publish with. The social resolver simply never
-- received it. This table is the missing half: per (site, platform), the
-- account that site posts to.
--
-- Resolution order after this migration, in lib/social-accounts:
--   1. an explicit social_accounts.id passed per post   (Pro, unchanged)
--   2. this table, for the post's own site              (new)
--   3. the user's is_default row for the platform       (unchanged)
--   4. the legacy single columns on integrations        (unchanged)
--
-- So a creator who sets nothing here keeps exactly today's behaviour. That
-- matters: this ships to everyone, and only multi-site creators asked for it.
--
-- Both foreign keys cascade on delete. Removing a site or disconnecting an
-- account removes the mapping rather than leaving a row pointing at nothing,
-- and resolution falls back to step 3, which is a working account.
--
-- Safe to run more than once.

create table if not exists public.site_social_defaults (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  -- The wordpress_sites row. Never the 'legacy' sentinel: that means the
  -- creator is still on integrations.wordpress_* with no site row, which is by
  -- definition a single-site account and has nothing to route.
  site_id           uuid not null references public.wordpress_sites(id) on delete cascade,
  -- Free text, matching social_accounts.platform, so a new platform needs no
  -- migration here either.
  platform          text not null,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- One account per site per platform. The upsert in the settings screen
  -- targets this constraint.
  unique (site_id, platform)
);

create index if not exists site_social_defaults_user_idx
  on public.site_social_defaults (user_id, platform);

create index if not exists site_social_defaults_site_idx
  on public.site_social_defaults (site_id);

alter table public.site_social_defaults enable row level security;

-- Owner-only RLS, matching social_accounts and the rest of the schema.
drop policy if exists "site_social_defaults_owner_all" on public.site_social_defaults;
create policy "site_social_defaults_owner_all" on public.site_social_defaults
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.site_social_defaults is
  'Per-site social routing: which social_accounts row a given wordpress_sites row posts to for a platform. Consulted between the explicit per-post choice and the user-wide is_default. Empty means the account behaves exactly as it did before this table existed.';
