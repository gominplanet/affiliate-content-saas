-- 351 — storefront coverage: a standing map, not a run.
--
-- WHAT WAS WRONG. The back catalogue modelled RUNS. You start one, it scans, it
-- ends. That is not a thing in a creator's world, and it produced the same trap
-- three times in one day: a run open in another tab, market ticks describing a
-- different run than the numbers under them, and a button the error message
-- named that only existed once a run was loaded.
--
-- WHAT IS ACTUALLY TRUE. A creator has N videos and M storefronts they have
-- ticked. That is a permanent grid of N times M cells, each with exactly one
-- answer: is this video on that product page in that country, and if not, why.
-- The grid never starts or finishes. It drains. A new video joins it the moment
-- the channel syncs; a newly ticked market adds a column.
--
-- TWO TABLES.
--   storefront_markets  which stores this creator wants, and whether SCOUT has
--                       confirmed they are signed in to each one. Ticking is a
--                       decision; signed-in is a fact, and they are stored apart
--                       because a screen that conflates them tells somebody
--                       their listings are going somewhere they cannot reach.
--   storefront_coverage one row per (video, market). The whole point.
--
-- UPLOADED IS NOT LIVE. `uploaded` means SCOUT finished the upload. `live` means
-- the video was afterwards found on the storefront. Those were one state before,
-- which made the entire map a claim rather than a record.
--
-- Safe to run more than once.

-- ── the markets a creator has ticked ────────────────────────────────────────
create table if not exists public.storefront_markets (
  user_id       uuid not null references auth.users(id) on delete cascade,
  domain        text not null,                 -- amazon.de
  -- The decision. Untick and the drain stops working on that column; the rows
  -- stay, so re-ticking does not re-do work already done.
  enabled       boolean not null default true,
  -- The fact, reported by SCOUT from the creator's own browser session:
  -- ready | not_signed_in | not_enrolled | unknown
  signin_state  text not null default 'unknown',
  signin_detail text,
  signin_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, domain)
);

-- ── one row per video per market, forever ───────────────────────────────────
create table if not exists public.storefront_coverage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  video_id      uuid not null references public.youtube_videos(id) on delete cascade,
  domain        text not null,
  -- unknown     nothing has been checked yet
  -- preparing   the drain is working on it (track, translation, dub, thumbnail)
  -- ready       everything is prepared and it is waiting for SCOUT
  -- uploading   handed to SCOUT in this session
  -- uploaded    SCOUT finished the upload
  -- live        afterwards FOUND on the storefront. Not the same as uploaded.
  -- blocked     it cannot go, and `reason` says why
  state         text not null default 'unknown',
  reason        text,
  -- The ASIN this listing points at IN THIS MARKET, which is often not the US
  -- one: a product relisted abroad carries a different code.
  asin          text,
  -- Which voice the audio ended up being, so the screen can stop guessing:
  -- youtube | cloned | standard | none
  voice         text,
  -- The storefront sync job that carried it, for tracing a failure back.
  sync_job_id   uuid,
  -- Ordering for the drain. Higher goes first. Recency plus whether the product
  -- is still in stock, recomputed as those change.
  priority      integer not null default 0,
  checked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, video_id, domain)
);

-- The drain's claim query: the most valuable unfinished cell in an enabled
-- market. Partial, because finished cells are most of the table and it should
-- never pay to skip past them.
create index if not exists storefront_coverage_drain_idx
  on public.storefront_coverage (user_id, priority desc, created_at)
  where state in ('unknown', 'preparing');

-- The delivery window's query: what is waiting for SCOUT right now.
create index if not exists storefront_coverage_ready_idx
  on public.storefront_coverage (user_id, domain)
  where state = 'ready';

-- The map screen, per market.
create index if not exists storefront_coverage_market_idx
  on public.storefront_coverage (user_id, domain, state);

-- Tracing one video across every market.
create index if not exists storefront_coverage_video_idx
  on public.storefront_coverage (video_id);

alter table public.storefront_markets  enable row level security;
alter table public.storefront_coverage enable row level security;

drop policy if exists "storefront_markets_owner_all" on public.storefront_markets;
create policy "storefront_markets_owner_all" on public.storefront_markets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "storefront_coverage_owner_all" on public.storefront_coverage;
create policy "storefront_coverage_owner_all" on public.storefront_coverage
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.storefront_coverage is
  'One row per video per Amazon marketplace, permanently. Replaces the run model: a run is not a thing in a creator''s world, a grid of "is this video earning in that country, and if not why" is. uploaded means SCOUT finished; live means it was afterwards found on the storefront.';

comment on column public.storefront_coverage.priority is
  'Drain order, highest first. Recency of the video plus whether the product is still in stock in that market, so the queue is always working on the most valuable thing not yet done.';

comment on column public.storefront_markets.signin_state is
  'Reported by SCOUT from the creator''s own browser. Kept apart from `enabled` because ticking a market is a decision and being signed in to it is a fact, and a screen that conflates them promises listings somewhere they cannot be delivered.';
