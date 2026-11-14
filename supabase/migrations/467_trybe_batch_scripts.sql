-- 467: batch scripts for a brand challenge (Seb, 2026-11-14: "we need to add a
-- functionality into trybe scriptwriting so people can do batches of
-- scripts"). A campaign holds the setup (product, the brief's rules, where the
-- creator can film, who is on camera); its scripts are written in rounds of
-- ten, checked against the rules, and tracked from draft to accepted with the
-- submission link (lib/trybe-batch, app/api/labs/trybe-batch).
--
-- Written and read by the server only (no policies).
--
-- Safe to run twice.

create table if not exists public.trybe_campaigns (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  brand_id    text,
  name        text        not null,
  setup       jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists trybe_campaigns_user_idx on public.trybe_campaigns (user_id, updated_at desc);

create table if not exists public.trybe_campaign_scripts (
  id              uuid        primary key default gen_random_uuid(),
  campaign_id     uuid        not null references public.trybe_campaigns(id) on delete cascade,
  user_id         uuid        not null references auth.users(id) on delete cascade,
  idx             integer     not null,
  title           text        not null default '',
  angle           text,
  host            text,
  location        text,
  real_story      boolean     not null default false,
  reality_reason  text,
  story           jsonb       not null default '[]'::jsonb,
  body            jsonb       not null default '[]'::jsonb,
  est_seconds     integer,
  status          text        not null default 'draft',
  link            text,
  notes           text,
  checks          jsonb       not null default '{}'::jsonb,
  tries           integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists trybe_campaign_scripts_idx on public.trybe_campaign_scripts (campaign_id, idx);
create index if not exists trybe_campaign_scripts_user_idx on public.trybe_campaign_scripts (user_id, created_at desc);

alter table public.trybe_campaigns enable row level security;
alter table public.trybe_campaign_scripts enable row level security;

notify pgrst, 'reload schema';
