-- 357 — launch batches: set up ten videos, walk away, come back to one button.
--
-- WHAT THIS IS FOR. Video Launchpad is one video with a creator watching it.
-- That is the right shape for one video and the wrong shape for ten: the slow
-- parts (the CTA burn, the thumbnail, the geo research, the translation, every
-- dub) all run on our servers and need nobody present, and making a creator sit
-- through them ten times is the whole friction.
--
-- So a batch is: choose the CTA and the countries ONCE, add up to ten videos
-- each with its own product, press Prepare, close the tab. Everything that can
-- run unattended does. What comes back is a board saying, per video, what is
-- done and what is blocked and why.
--
-- THE ONE THING THAT CANNOT BE UNATTENDED is the Amazon upload. SCOUT drives
-- the creator's own logged-in Creator Hub in their own browser, and there is no
-- server-side session for amazon.de. That is how Amazon works, not a gap we can
-- engineer away. YouTube is different: we hold an OAuth token, so publishing
-- and scheduling there are genuinely automatic.
--
-- SHARED ONCE, UNIQUE PER VIDEO. The CTA design and its placement are chosen
-- once and reproduced on every video in the batch. The countries likewise.
-- Everything else belongs to one video: its product, its title, its thumbnail,
-- its dubs. A batch is ten separate videos that happen to share a CTA, never
-- ten variants of one thing.
--
-- Safe to run more than once.

create table if not exists public.launch_batches (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null default 'Untitled batch',
  -- draft      still being filled in
  -- preparing  the worker is rendering, researching and dubbing
  -- ready      everything that can be done without the creator is done
  -- launching  YouTube scheduling and the Amazon hand-off are under way
  -- launched   nothing left that this batch itself can do
  state       text not null default 'draft',

  -- ── chosen once, reproduced on every video ────────────────────────────────
  -- The CTA and its placement, in whatever shape the render pipeline takes.
  -- Stored whole rather than as columns because it is one decision the creator
  -- makes once, and splitting it into fields invites half of it being applied.
  cta         jsonb,
  -- The Amazon storefronts this batch delivers to.
  markets     text[] not null default '{}',

  -- ── the publishing cadence ────────────────────────────────────────────────
  -- HOW MANY A DAY IS PERSONAL. Seb posts three a day; somebody else posts one.
  -- So the batch carries the times of day itself, one slot per video per day,
  -- and the number of slots IS the videos-per-day.
  daily_slots text[] not null default '{"09:00"}',
  -- The first day anything goes out. Local to the creator, see `timezone`.
  start_on    date,
  -- IANA zone, captured from the creator's own browser.
  --
  -- NOT OPTIONAL, and not a display detail. YouTube's publishAt is an absolute
  -- instant. Without the zone, "09:00" means 09:00 UTC, and a creator in
  -- Toronto would find their videos going public at five in the morning. It is
  -- also the only way a slot survives a daylight-saving change: the creator
  -- means nine o'clock, not a fixed offset from UTC.
  timezone    text not null default 'UTC',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.launch_items (
  id            uuid primary key default gen_random_uuid(),
  batch_id      uuid not null references public.launch_batches(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Order in the batch, and therefore order in the publishing schedule.
  position      integer not null,

  -- ── the video ─────────────────────────────────────────────────────────────
  source_url    text,          -- what the creator uploaded
  rendered_url  text,          -- the same video with the batch's CTA burned in
  clean_url     text,          -- no CTA, which is what Amazon gets
  duration_seconds integer,

  -- ── its own product and its own copy ──────────────────────────────────────
  asin          text,
  title         text,
  description   text,
  tags          text,
  thumbnail_url text,          -- branded, with text, for YouTube and the English stores
  thumbnail_clean_url text,    -- text-free, for the non-English stores

  -- ── what happened ─────────────────────────────────────────────────────────
  -- draft      added, nothing done yet
  -- rendering  the CTA is being burned in
  -- preparing  thumbnail, product research, translation and dubs
  -- prepared   everything unattended is done; waiting for Launch
  -- scheduled  YouTube has it and knows when to make it public
  -- published  it is live on YouTube
  -- blocked    it cannot go, and `reason` says why in the creator's words
  state         text not null default 'draft',
  reason        text,

  -- ── the YouTube half ──────────────────────────────────────────────────────
  youtube_video_id text,
  -- WHAT YOUTUBE WAS ACTUALLY TOLD, written after the API confirmed it rather
  -- than when we worked it out. A column holding the time we intended would let
  -- a screen promise a publication that was never scheduled.
  publish_at    timestamptz,

  -- The row in youtube_videos this became, so the Amazon half is the same
  -- coverage grid everything else uses rather than a second pipeline.
  video_id      uuid references public.youtube_videos(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (batch_id, position)
);

create index if not exists launch_batches_user_idx
  on public.launch_batches (user_id, created_at desc);
create index if not exists launch_items_batch_idx
  on public.launch_items (batch_id, position);
-- The worker's claim query: items with work left. Partial, because a finished
-- batch is most of the table before long.
create index if not exists launch_items_open_idx
  on public.launch_items (user_id, created_at)
  where state in ('draft', 'rendering', 'preparing');

alter table public.launch_batches enable row level security;
alter table public.launch_items   enable row level security;

drop policy if exists "launch_batches_owner_all" on public.launch_batches;
create policy "launch_batches_owner_all" on public.launch_batches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "launch_items_owner_all" on public.launch_items;
create policy "launch_items_owner_all" on public.launch_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.launch_batches is
  'Ten videos set up together, sharing one CTA and one set of Amazon countries. Everything that can run without the creator does; only the Amazon upload needs their browser, because SCOUT drives their own logged-in Creator Hub and there is no server-side session for amazon.de.';

comment on column public.launch_batches.timezone is
  'IANA zone from the creator''s own browser. Not a display detail: YouTube''s publishAt is an absolute instant, so without it "09:00" means 09:00 UTC and a creator in Toronto finds their videos going public at five in the morning. It is also what lets a slot survive a daylight-saving change, since the creator means nine o''clock rather than a fixed offset.';

comment on column public.launch_batches.daily_slots is
  'One time of day per video per day, so the number of slots IS the videos-per-day. How many a creator posts a day is personal: three for one, one for another.';

comment on column public.launch_items.publish_at is
  'What YouTube was actually told, written after the API confirmed the schedule rather than when we worked it out. Storing the intended time would let a screen promise a publication that was never scheduled.';

notify pgrst, 'reload schema';
