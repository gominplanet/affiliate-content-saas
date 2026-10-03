-- The Facebook hub: what MVP put on the creator's Facebook, so the hub can say
-- for each review and clip whether it is in their Group, on their Page, both,
-- or not on Facebook yet, and link to each.
--
-- One row per push: a blog post (kind 'blog') or a clip (kind 'clip').
-- group_post_url: the Group post (or the Reel address of a Group video).
-- page_post_url: the Page post or Page Reel that points to it; null when the
-- Group post went up and the Page part did not.
--
-- Safe to run twice.

create table if not exists public.facebook_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  source_id text,
  video_id uuid,
  title text,
  group_url text,
  group_post_url text,
  page_post_url text,
  created_at timestamptz not null default now()
);

create index if not exists facebook_posts_user_at on public.facebook_posts (user_id, created_at desc);

alter table public.facebook_posts enable row level security;

drop policy if exists "own facebook posts" on public.facebook_posts;
create policy "own facebook posts" on public.facebook_posts
  for select using (auth.uid() = user_id);
