-- 436 — Drop: the creator drops finished videos in one place and presses one
-- Launch button (Labs, admin while it is tested; Seb, 2026-10-17).
--
-- A drop is what the creator asked for, per video, and what actually happened,
-- per video and per place. The work itself is done by the engines that already
-- exist: a long video goes to YouTube and Amazon through a Liftoff batch the
-- drop builds, its blog post is scheduled to go live after the video, and a
-- vertical video goes to a TRYBE brand through SCOUT.
--
-- WHAT HAPPENED IS KEPT APART FROM WHAT WAS ASKED. `to_blog` is the wish;
-- `blog_state` is the result, written only after the blog route answered. A
-- board that showed the wish would say "blog scheduled" about a post that was
-- never written.
--
-- Safe to run more than once.

create table if not exists public.drops (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default 'Drop',
  -- building   the Liftoff batch is being made
  -- preparing  Liftoff is preparing the videos; Launch follows on its own
  -- needs_you  something only the creator can decide, `note` says what
  -- launched   Liftoff has the videos and their times
  -- done       nothing left that this drop itself does
  -- failed     it stopped, `note` says why
  state       text not null default 'building',
  note        text,
  batch_id    uuid references public.launch_batches(id) on delete set null,
  -- The Liftoff batch the shared settings were copied from, so the board can
  -- say whose CTA, thumbnail look and times these are.
  settings_from uuid,
  launched_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.drop_items (
  id            uuid primary key default gen_random_uuid(),
  drop_id       uuid not null references public.drops(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  position      integer not null default 0,

  -- ── the file ──────────────────────────────────────────────────────────────
  file_name     text,
  source_url    text,
  mime_type     text,
  size_bytes    bigint,
  duration_seconds integer,
  width         integer,
  height        integer,
  -- long | vertical, from the file's own frame size
  kind          text not null default 'long',

  -- ── what the creator asked for ────────────────────────────────────────────
  asin          text,
  title         text,
  to_liftoff    boolean not null default false,
  to_blog       boolean not null default false,
  to_trybe      boolean not null default false,

  -- ── what happened: YouTube and Amazon ─────────────────────────────────────
  launch_item_id uuid references public.launch_items(id) on delete set null,

  -- ── what happened: the blog ───────────────────────────────────────────────
  -- off | wanted | writing | scheduled | failed
  blog_state    text not null default 'off',
  blog_detail   text,
  blog_post_id  uuid,
  blog_url      text,
  blog_at       timestamptz,

  -- ── what happened: TRYBE ──────────────────────────────────────────────────
  -- off | wanted | sending | in_review | sent_unconfirmed | failed
  trybe_state   text not null default 'off',
  trybe_brand_id text,
  trybe_brand_name text,
  trybe_program_id text,
  trybe_angle_id text,
  trybe_product_ids text[] not null default '{}',
  trybe_exclusive boolean not null default false,
  trybe_notes   text,
  trybe_submission_id text,
  trybe_detail  text,
  trybe_steps   jsonb,
  trybe_at      timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists drops_user_idx on public.drops (user_id, created_at desc);
create index if not exists drop_items_drop_idx on public.drop_items (drop_id, position);
create index if not exists drop_items_user_idx on public.drop_items (user_id, created_at desc);

-- Written by MVP's server (service role) after it checks the creator; each
-- creator may read their own.
alter table public.drops enable row level security;
alter table public.drop_items enable row level security;

drop policy if exists "own drops" on public.drops;
create policy "own drops" on public.drops
  for select using (auth.uid() = user_id);

drop policy if exists "own drop items" on public.drop_items;
create policy "own drop items" on public.drop_items
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
