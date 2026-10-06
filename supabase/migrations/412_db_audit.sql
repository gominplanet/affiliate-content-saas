-- 412: Database contract audit (2026-10-06). Safe to run twice: every column
-- is `add column if not exists`, the policy is dropped before it is created,
-- the foreign key is only rebuilt while it still cascades, and every index is
-- `create index if not exists`.

set statement_timeout = 0;

-- ── 1. Columns the code reads and writes that no migration ever created ─────
-- These were added by hand in the Supabase editor (lib/types/database.ts, which
-- is generated from the live database, has every one of them), so on the live
-- database each line below does nothing. They are written down here so a
-- fresh database matches the code, and so `npm run schema:audit` checks them:
-- the audit only knows what a migration promises. Types match the live ones.
alter table public.integrations
  add column if not exists tier text not null default 'trial',
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists amazon_associates_tag text,
  add column if not exists geniuslink_api_secret text,
  add column if not exists blog_customizations jsonb,
  add column if not exists wordpress_api_token text,
  add column if not exists setup_status text,
  add column if not exists setup_job_id text,
  add column if not exists setup_subscription_id text,
  add column if not exists facebook_page_id text,
  add column if not exists facebook_page_name text,
  add column if not exists facebook_page_access_token text,
  add column if not exists facebook_pages_json text,
  add column if not exists linkedin_access_token text,
  add column if not exists linkedin_person_id text,
  add column if not exists linkedin_person_name text,
  add column if not exists pinterest_access_token text,
  add column if not exists pinterest_refresh_token text,
  add column if not exists pinterest_board_id text,
  add column if not exists pinterest_board_name text,
  add column if not exists pinterest_boards_json text,
  add column if not exists threads_access_token text,
  add column if not exists threads_user_id text,
  add column if not exists youtube_oauth_access_token text,
  add column if not exists youtube_oauth_refresh_token text,
  add column if not exists youtube_oauth_token_expiry bigint;

alter table public.blog_posts
  add column if not exists has_images boolean,
  add column if not exists image_prompts jsonb,
  add column if not exists threads_post_id text,
  add column if not exists linkedin_post_id text,
  add column if not exists facebook_post_id text,
  add column if not exists pinterest_pin_id text;

-- "Set the product" on a video (app/api/youtube/videos/set-product) writes
-- product_title next to product_url, and the drafts list reads it. Not in any
-- migration and not in the generated types either, so this one may really be
-- missing: without it, setting a product fails with "Could not save the
-- product", and the drafts list never shows the product a creator set.
alter table public.youtube_videos
  add column if not exists product_title text;

-- ── 2. Members can take back a queued social push ────────────────────────
-- scheduled_posts had select, insert and update policies but no delete
-- policy, so the two places that delete through the member's own client
-- (Edit schedule "remove this platform", and deleting a post, which cancels
-- its queued pushes first) deleted nothing and reported no error: a platform
-- the creator removed still published. Only pending rows: a push that has
-- run stays as the record of what happened.
drop policy if exists "scheduled_posts_delete_own" on public.scheduled_posts;
create policy "scheduled_posts_delete_own" on public.scheduled_posts
  for delete using (auth.uid() = user_id and status = 'pending');

-- ── 3. Deleting a video row no longer deletes the blog posts made from it ──
-- blog_posts.video_id was `on delete cascade` (schema.sql). MVP deletes a
-- youtube_videos row by itself when YouTube says the video is gone
-- (lib/first-comments), and a cascade there took the creator's published
-- blog posts with it. The post stands on its own, so it now keeps everything
-- and just loses the link to the video (video_id is nullable since 024).
-- Dropped by shape, not by guessed name, as in 348. Skipped when the key
-- already sets null, so a second run changes nothing.
do $$
declare
  c record;
  col smallint;
begin
  select attnum into col from pg_attribute
   where attrelid = 'public.blog_posts'::regclass and attname = 'video_id';
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.blog_posts'::regclass
       and contype = 'f'
       and confrelid = 'public.youtube_videos'::regclass
       and conkey = array[col]
       and confdeltype = 'n'
  ) then
    raise notice '412: blog_posts.video_id already sets null on delete';
    return;
  end if;
  for c in
    select conname from pg_constraint
     where conrelid = 'public.blog_posts'::regclass
       and contype = 'f'
       and confrelid = 'public.youtube_videos'::regclass
       and conkey = array[col]
  loop
    execute format('alter table public.blog_posts drop constraint %I', c.conname);
  end loop;
  alter table public.blog_posts
    add constraint blog_posts_video_id_fkey
    foreign key (video_id) references public.youtube_videos(id) on delete set null;
end $$;

-- ── 4. Indexes for queries that run every minute or on every delete ───────
-- Run the index query `npm run schema:audit` prints first if in doubt: one of
-- these may already exist under another name, added by hand.

-- Deleting a blog post looks up its scheduled_posts (the cascade), and Edit
-- schedule, post delete and the generation runner all filter on blog_post_id.
create index if not exists scheduled_posts_blog_post_idx
  on public.scheduled_posts (blog_post_id) where blog_post_id is not null;

-- Deleting a youtube_videos row looks up every table that points at it.
-- These three had no index that starts with video_id; the check before a
-- video row is deleted (lib/first-comments holdsMadeContent) and the
-- coverage and video-hold crons filter on video_id alone.
create index if not exists scheduled_posts_video_idx
  on public.scheduled_posts (video_id) where video_id is not null;
create index if not exists blog_posts_video_idx
  on public.blog_posts (video_id) where video_id is not null;
create index if not exists launch_items_video_idx
  on public.launch_items (video_id) where video_id is not null;

-- launch-drain runs every minute and reads launch_items by state, oldest
-- update first (stale renders, scheduled confirmations, blocked retries,
-- Amazon hand-over repairs). The existing state indexes cover only the open
-- states and 'prepared'.
create index if not exists launch_items_state_updated_idx
  on public.launch_items (state, updated_at);

-- launch-drain's first comment catch-up, every minute: uploaded items by most
-- recent update, then their video_first_comments rows by YouTube id across
-- every account (the existing unique index starts with user_id).
create index if not exists launch_items_uploaded_recent_idx
  on public.launch_items (updated_at desc) where youtube_video_id is not null;
create index if not exists video_first_comments_youtube_video_idx
  on public.video_first_comments (youtube_video_id);

analyze public.scheduled_posts;
analyze public.blog_posts;
analyze public.launch_items;
analyze public.video_first_comments;

notify pgrst, 'reload schema';
