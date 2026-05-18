-- Migration 028: AI usage / cost telemetry
--
-- One row per billable AI call (token counts + web searches + images),
-- tagged with the user's tier and the feature that triggered it. Powers
-- the admin-only cost dashboard so per-tier COGS comes from real data
-- instead of estimates.
--
-- Written via the service-role client (fire-and-forget); RLS is enabled
-- with NO policies so normal users can neither read nor write it — only
-- the service role (admin dashboard) can.

create table if not exists public.ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  tier          text,
  feature       text not null,
  model         text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  web_searches  integer not null default 0,
  images        integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists ai_usage_created_idx on public.ai_usage (created_at desc);
create index if not exists ai_usage_tier_idx    on public.ai_usage (tier, created_at desc);
create index if not exists ai_usage_feature_idx on public.ai_usage (feature, created_at desc);

alter table public.ai_usage enable row level security;
-- Intentionally no policies: service-role only.
