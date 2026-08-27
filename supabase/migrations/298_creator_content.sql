-- 298 — Brand Radar content library (the proof-of-work layer).
--
-- Brand Radar's headline is "the brands you've worked with AND the content you
-- made for each" — so we have to keep the CONTENT LINKS, not just brand counts.
-- creator_content is one row per produced piece: an Amazon shoppable video /
-- product, or a TikTok post, tied to the brand it features and a direct link.
-- Grouped by brand_key it becomes a per-brand portfolio; filtered to a pasted
-- marketplace list it becomes "here are my receipts for this brand."
--
-- brand_key is the normalized match key (lib/brand-normalize) so Amazon + TikTok
-- dedupe and an external name (TRYBE) matches. Idempotent.

create table if not exists public.creator_content (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  platform      text not null,              -- 'amazon' | 'tiktok'
  kind          text,                       -- 'video' | 'product' | 'post'
  brand         text,                       -- display name
  brand_key     text,                       -- normalized match key
  url           text not null,              -- the direct content link
  title         text,
  thumbnail     text,
  external_id   text,                       -- asin / tiktok id (dedupe)
  asin          text,
  posted_at     timestamptz,
  earnings_cents integer,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, platform, external_id)
);

create index if not exists creator_content_user_brand_idx on public.creator_content (user_id, brand_key);
create index if not exists creator_content_user_platform_idx on public.creator_content (user_id, platform);

alter table public.creator_content enable row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='creator_content' and policyname='own content read'
  ) then
    create policy "own content read" on public.creator_content for select using (auth.uid() = user_id);
  end if;
end $$;

notify pgrst, 'reload schema';
