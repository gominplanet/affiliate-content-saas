-- 429: video ideas kept for every brand (Seb, 2026-10-13: "save ideas for
-- each brands"). One row per plan a creator made: the brand (joined on TRYBE
-- directly or found through MVP), the product they had on hand, and the ten
-- ideas. The newest plan per product is what the page shows; the spreadsheet
-- export turns them into a shooting list.
--
-- Written and read by the server only (no policies).
--
-- Safe to run twice.

create table if not exists public.trybe_ideas (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  brand_id    text        not null,
  brand_name  text,
  product     text,
  plan        jsonb       not null,
  created_at  timestamptz not null default now()
);

create index if not exists trybe_ideas_user_brand_idx on public.trybe_ideas (user_id, brand_id, created_at desc);

alter table public.trybe_ideas enable row level security;

notify pgrst, 'reload schema';
