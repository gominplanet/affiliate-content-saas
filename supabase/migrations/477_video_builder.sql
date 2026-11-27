-- The Video Builder (components/labs/TrybeStudio): one project per creator,
-- brand and product, holding the video type, the modular scripts (hooks,
-- bodies, CTAs and the B-roll shot list), their check against the brand's
-- rules, and the options and music picked before Process. Each video made
-- from it knows its project. Safe to run twice.
create table if not exists public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  brand_id text not null,
  brand_name text,
  product text not null,
  video_type text not null default 'talking',
  scripts jsonb,
  script_check jsonb,
  options jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists studio_projects_one on public.studio_projects (user_id, brand_id, product);
alter table public.studio_projects enable row level security;

alter table public.review_edits add column if not exists studio_project_id uuid;
create index if not exists review_edits_project_idx on public.review_edits (studio_project_id) where studio_project_id is not null;

notify pgrst, 'reload schema';
