-- 219 — scheduled Deal Radar quick posts.
--
-- The "Quick post to socials" modal can now SCHEDULE a deal instead of firing it
-- immediately, so a creator can space posts out. Each row is one deal queued for
-- one future time; the process-deal-schedules cron claims due rows and publishes
-- them through the exact same path as an immediate quick post (lib/deal-quick-post).
--
-- Caveat baked into the cron: if the deal has rotated out of deal_radar_cache by
-- fire time (the deal ended), the post is NOT sent — it's marked 'skipped'. You
-- never promote a dead deal.

create table if not exists deal_scheduled_posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  asin          text not null,
  title         text,          -- snapshot, so the card renders in "Scheduled" lists
  image_url     text,
  platforms     text[] not null default '{}',
  story         boolean not null default false,
  caption       text,          -- user override; blank ⇒ cron auto-writes price-safe
  scheduled_at  timestamptz not null,
  status        text not null default 'pending',  -- pending | processing | completed | failed | skipped
  claimed_at    timestamptz,
  error_message text,
  results       jsonb,          -- per-platform results after the cron runs
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The cron's claim query: due + pending, oldest first.
create index if not exists deal_scheduled_posts_due_idx
  on deal_scheduled_posts (status, scheduled_at);
-- A creator's own "Scheduled" list, newest first.
create index if not exists deal_scheduled_posts_user_idx
  on deal_scheduled_posts (user_id, scheduled_at desc);

alter table deal_scheduled_posts enable row level security;

-- Creators see and manage only their own scheduled posts. The cron uses the
-- service-role (admin) client, which bypasses RLS.
drop policy if exists deal_scheduled_posts_select_own on deal_scheduled_posts;
create policy deal_scheduled_posts_select_own on deal_scheduled_posts
  for select using (auth.uid() = user_id);

drop policy if exists deal_scheduled_posts_insert_own on deal_scheduled_posts;
create policy deal_scheduled_posts_insert_own on deal_scheduled_posts
  for insert with check (auth.uid() = user_id);

drop policy if exists deal_scheduled_posts_update_own on deal_scheduled_posts;
create policy deal_scheduled_posts_update_own on deal_scheduled_posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists deal_scheduled_posts_delete_own on deal_scheduled_posts;
create policy deal_scheduled_posts_delete_own on deal_scheduled_posts
  for delete using (auth.uid() = user_id);
