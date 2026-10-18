-- 441 — QR codes burned into the YouTube cut (docs/qr-on-youtube-plan.md).
--
-- A viewer watching a review on a television cannot click anything: there is
-- no description box for them. A QR on screen is the only way they reach the
-- product. This is the record behind that QR.
--
-- THE QR ENCODES A PERMANENT CODE. IT NEVER ENCODES A DESTINATION.
--
-- A published video cannot be recalled, patched or reburned. Whatever is in
-- that QR is there for as long as the video exists, so the only durable thing
-- to put in it is a code we resolve ourselves, at scan time. The code is bound
-- to the VIDEO, not to a post and not to a product page. When the creator
-- writes the blog post later, the post is attached here and every QR already
-- in the wild moves with it.
--
-- A /v/ CODE CAN NEVER RESOLVE TO AN AMAZON URL. That is the whole compliance
-- argument, so it is a guarantee in lib/video-codes and a test that fails if
-- it ever stops being true. Passport links (/go/) resolve to Amazon with the
-- creator's tag. These resolve to content the creator owns. The hop looks the
-- same from outside and the endpoint is the entire difference.
--
-- A CHURNED CREATOR'S CODES KEEP RESOLVING, permanently and free. Their videos
-- run forever with our code burned in. Rows are never deleted on cancellation.
--
-- Safe to run more than once.

create table if not exists public.video_codes (
  -- Short base62, what the QR actually contains, as mvpaffiliate.io/v/<code>.
  code          text primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- ── what the code is bound to ─────────────────────────────────────────────
  -- The Liftoff row the QR was burned into. Set null if the row is tidied up:
  -- the code still resolves, because the video is still on YouTube.
  launch_item_id uuid references public.launch_items(id) on delete set null,
  -- Filled once YouTube has it, so a scan can be traced back to a video.
  youtube_video_id text,
  asin          text,

  -- ── where a scan goes ─────────────────────────────────────────────────────
  -- The creator's own post for this video, once one exists. Null means the
  -- resolver works the destination out live, which is the normal case: most
  -- burns happen before any post is written.
  post_url      text,
  -- The shop handle at burn time, so a scan still lands somewhere real if the
  -- live lookup fails. Never a destination on its own: see lib/video-codes.
  handle        text,

  -- active | off. 'off' is a moderator switch, not a billing one.
  state         text not null default 'active',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists video_codes_user_idx on public.video_codes (user_id, created_at desc);
create index if not exists video_codes_item_idx on public.video_codes (launch_item_id);
create index if not exists video_codes_asin_idx on public.video_codes (user_id, asin);

-- One row per scan, for the creator's own report. A QR nobody scans is a
-- thing worth knowing: reported CTV scan rates run well under one percent.
create table if not exists public.video_code_scans (
  id          uuid primary key default gen_random_uuid(),
  code        text not null references public.video_codes(code) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  country     text,
  device      text,
  browser     text,
  os          text,
  at          timestamptz not null default now()
);

create index if not exists video_code_scans_code_idx on public.video_code_scans (code, at desc);
create index if not exists video_code_scans_user_idx on public.video_code_scans (user_id, at desc);

-- ── the burn ────────────────────────────────────────────────────────────────
-- One decision per batch, replayed on every video in it, exactly like the CTA.
-- qr_chosen exists for the reason cta_chosen does: "no QR on any of them" and
-- "they have not decided yet" are both an empty qr column, and the worker
-- would wait forever for an answer it already has.
alter table public.launch_batches add column if not exists qr jsonb;
alter table public.launch_batches add column if not exists qr_chosen boolean not null default false;

comment on column public.launch_batches.qr_chosen is
  'True once the creator has decided, INCLUDING deciding on no QR at all.';

-- The code burned into THIS video, and the PNG that was burned. Both null on
-- a video with no QR, which is most of them.
alter table public.launch_items add column if not exists qr_code text;
alter table public.launch_items add column if not exists qr_image_url text;

-- ── what the creator told Amazon ────────────────────────────────────────────
-- A QR is only burned once the creator has declared the page it lands on in
-- their Amazon Website and Mobile App List and made a tracking ID for it. No
-- declaration, no QR: see qrSetupMissing in lib/video-codes.
alter table public.integrations add column if not exists qr_shop_declared_at timestamptz;
alter table public.integrations add column if not exists qr_tracking_id text;

comment on column public.integrations.qr_shop_declared_at is
  'When the creator confirmed they added their shop page URL to their Amazon Website and Mobile App List. Null means no QR may be burned for them.';

alter table public.video_codes enable row level security;
alter table public.video_code_scans enable row level security;

drop policy if exists "own video codes" on public.video_codes;
create policy "own video codes" on public.video_codes
  for select using (auth.uid() = user_id);

drop policy if exists "own video code scans" on public.video_code_scans;
create policy "own video code scans" on public.video_code_scans
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';
