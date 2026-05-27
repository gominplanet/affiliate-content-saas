-- 070 — Per-post SEO snapshot cache
--
-- Caches the computed SEO/AEO score + the Google Search Console signals
-- (indexing status, impressions/clicks/position, top queries) for each post so
-- the SEO hub loads instantly and we don't burn GSC's URL-Inspection quota
-- (2000/day) on every dashboard view. Refreshed on demand / when stale.

create table if not exists public.post_seo (
  post_id        uuid primary key references public.blog_posts(id) on delete cascade,
  user_id        uuid not null,
  url            text,
  indexed_state  text,          -- 'indexed' | 'not_indexed' | 'unknown'
  coverage_state text,          -- GSC's human-readable coverage (e.g. "Crawled - currently not indexed")
  last_crawl     text,
  impressions    integer default 0,
  clicks         integer default 0,
  position       real,
  ctr            real,
  top_queries    jsonb,         -- [{query, clicks, impressions, position}]
  seo_score      integer,       -- 0-100
  score_detail   jsonb,         -- [{id, label, pass, weight, hint}]
  checked_at     timestamptz default now()
);

create index if not exists post_seo_user_idx on public.post_seo(user_id);

alter table public.post_seo enable row level security;
drop policy if exists "post_seo_own" on public.post_seo;
create policy "post_seo_own" on public.post_seo
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
