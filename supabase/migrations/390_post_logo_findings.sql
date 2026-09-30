-- 390: store logos found in pictures already published on posts.
--
-- Amazon sometimes answered MVP's product photo fetch with a blocked page whose
-- share image is Amazon's logo, and MVP drew the article's pictures from it.
-- New posts are protected (lib/image-guard). This records, per published post,
-- when its pictures were looked at, and each picture that carries a store's
-- logo or could not be opened. A post whose pictures are replaced is looked at
-- again. Safe to run more than once.
alter table public.blog_posts add column if not exists logo_checked_at timestamptz;

create index if not exists blog_posts_logo_unchecked
  on public.blog_posts (created_at desc)
  where logo_checked_at is null and wordpress_post_id is not null;

create table if not exists public.post_logo_findings (
  post_id    uuid not null references public.blog_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  image_url  text not null,
  verdict    text not null check (verdict in ('found', 'unreadable')),
  marks      text[] not null default '{}',
  reason     text,
  checked_at timestamptz not null default now(),
  primary key (post_id, image_url)
);
create index if not exists post_logo_findings_user on public.post_logo_findings (user_id, verdict);

alter table public.post_logo_findings enable row level security;
drop policy if exists "own logo findings" on public.post_logo_findings;
create policy "own logo findings" on public.post_logo_findings
  for select using (auth.uid() = user_id);
