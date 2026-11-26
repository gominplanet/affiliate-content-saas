-- The Edit Studio, phases 1 and 2 (lib/studio-rules, app/api/labs/trybe-studio,
-- components/labs/TrybeStudio). Safe to run twice.

-- Phase 1: each brand's rules, per creator. sources: what MVP read, each with
-- the day it was read; history: earlier versions of a source that changed;
-- sheet: the do's and don'ts; questions: where the sources disagree.
create table if not exists public.trybe_brand_rules (
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id text not null,
  brand_name text,
  sources jsonb not null default '[]'::jsonb,
  history jsonb not null default '[]'::jsonb,
  sheet jsonb,
  questions jsonb not null default '[]'::jsonb,
  built_at timestamptz,
  edited_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, brand_id)
);
alter table public.trybe_brand_rules enable row level security;

-- Phase 2: a studio video knows its brand (its rules check it when it is
-- made) and what happened when it was sent to the brand on TRYBE.
alter table public.review_edits add column if not exists studio_brand_id text;
alter table public.review_edits add column if not exists studio_send jsonb;
create index if not exists review_edits_studio_idx on public.review_edits (user_id, studio_brand_id) where studio_brand_id is not null;

notify pgrst, 'reload schema';
