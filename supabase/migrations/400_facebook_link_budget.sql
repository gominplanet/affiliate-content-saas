-- Facebook setup: Meta's limit on outside-link posts from a Page.
--
-- integrations.facebook_link_limit: the creator's answer to "Does Facebook
-- limit your Page's links?" 'limited', 'unlimited' (pays for Meta One Max or
-- is not limited), 'unsure', or null (never answered).
-- integrations.facebook_link_allowance: links a month when limited (2, 8, 20).
--
-- facebook_link_posts: one row for every Page post MVP made that carried an
-- outside link, so MVP can say "Page links used: 1 of 2" and stop before a
-- post whose link Facebook would show as plain text.
--
-- Safe to run twice.

alter table public.integrations add column if not exists facebook_link_limit text;
alter table public.integrations add column if not exists facebook_link_allowance integer;

create table if not exists public.facebook_link_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  page_id text not null,
  post_id text,
  source text not null,
  created_at timestamptz not null default now()
);

create index if not exists facebook_link_posts_user_page_at
  on public.facebook_link_posts (user_id, page_id, created_at desc);

alter table public.facebook_link_posts enable row level security;

drop policy if exists "own facebook link posts" on public.facebook_link_posts;
create policy "own facebook link posts" on public.facebook_link_posts
  for select using (auth.uid() = user_id);
