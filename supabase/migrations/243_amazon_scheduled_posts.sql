-- Scheduled Amazon Influencer social posts (Art Director pin / IG / FB).
--
-- Unlike scheduled_posts (blog-tied, needs a blog_post_id) and
-- deal_scheduled_posts (publishes via the plain deal quick-post path), these are
-- standalone Art Director designs: a generated image + board/copy + affiliate
-- product, queued for a future time. The process-amazon-schedules cron claims
-- due rows and publishes them through lib/amazon-pin-publish. User-owned via RLS;
-- the cron uses the service-role client.
create table if not exists public.amazon_scheduled_posts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text not null default 'pinterest'
                  check (platform in ('pinterest', 'instagram', 'facebook')),
  image_url     text not null,
  asin          text,
  product_url   text,
  product_title text,
  board_id      text,
  title         text,
  description   text,
  scheduled_at  timestamptz not null,
  status        text not null default 'pending'
                  check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempts      int not null default 0,
  claimed_at    timestamptz,
  external_id   text,
  external_url  text,
  error_message text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The cron's claim query: due + pending, oldest first.
create index if not exists amazon_scheduled_posts_due_idx
  on public.amazon_scheduled_posts (scheduled_at)
  where status = 'pending';
-- A creator's own "Scheduled" list, newest first.
create index if not exists amazon_scheduled_posts_user_idx
  on public.amazon_scheduled_posts (user_id, scheduled_at desc);

alter table public.amazon_scheduled_posts enable row level security;

drop policy if exists "amazon_scheduled_posts_select_own" on public.amazon_scheduled_posts;
create policy "amazon_scheduled_posts_select_own" on public.amazon_scheduled_posts
  for select using (auth.uid() = user_id);

drop policy if exists "amazon_scheduled_posts_insert_own" on public.amazon_scheduled_posts;
create policy "amazon_scheduled_posts_insert_own" on public.amazon_scheduled_posts
  for insert with check (auth.uid() = user_id);

drop policy if exists "amazon_scheduled_posts_update_own" on public.amazon_scheduled_posts;
create policy "amazon_scheduled_posts_update_own" on public.amazon_scheduled_posts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "amazon_scheduled_posts_delete_own" on public.amazon_scheduled_posts;
create policy "amazon_scheduled_posts_delete_own" on public.amazon_scheduled_posts
  for delete using (auth.uid() = user_id);
