-- 428: TRYBE, what changed each day, and members' combined numbers
-- (Seb, 2026-10-13, after looking at TrybeDaily).
--
-- trybe_directory_changes: one row per change MVP saw on its shared copy of
-- TRYBE, written when the copy is updated: a brand new on the list, one that
-- left it or came back, its pay changing, its earnings tier changing, it
-- starting to run Meta ads, it entering TRYBE's Top 100.
--
-- trybe_directory.left_at: when a whole collection last missed the brand.
--
-- trybe_member_stats: each member's own numbers per brand, as SCOUT read them
-- from their TRYBE (My brands). Never shown one member at a time: MVP shows a
-- brand's combined approval rate and pay per approved video only when at
-- least 5 members have results for it and no one member is more than half.
-- A member who turns off "Include my results" has their rows deleted.
--
-- Written and read by the server only (no policies).
--
-- Safe to run twice.

create table if not exists public.trybe_directory_changes (
  id          bigserial   primary key,
  brand_id    text        not null,
  kind        text        not null,
  before      text,
  after       text,
  at          timestamptz not null default now()
);
create index if not exists trybe_directory_changes_at_idx on public.trybe_directory_changes (at desc);
create index if not exists trybe_directory_changes_brand_idx on public.trybe_directory_changes (brand_id, at desc);
alter table public.trybe_directory_changes enable row level security;

alter table public.trybe_directory add column if not exists left_at timestamptz;

create table if not exists public.trybe_member_stats (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  brand_id    text        not null,
  brand_name  text,
  submitted   integer,
  approved    integer,
  rejected    integer,
  earnings    numeric,
  updated_at  timestamptz not null default now(),
  primary key (user_id, brand_id)
);
create index if not exists trybe_member_stats_brand_idx on public.trybe_member_stats (brand_id);
alter table public.trybe_member_stats enable row level security;

alter table public.trybe_outreach_settings add column if not exists pool_opt_out boolean not null default false;

notify pgrst, 'reload schema';
