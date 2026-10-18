-- 442 — HOW THEY WIN: the words of TRYBE's Top 100 videos, kept once for
-- everyone (Seb, 2026-10-18, after TrybeDaily shipped "The Race").
--
-- A creator wants to see every Top 100 video for a brand and read what was
-- actually said in it. Two sources, and which one answered is recorded,
-- because they are not equally good:
--
--   trybe        GET submissions/{id}/script through the team's SCOUT. Free,
--                but thin: one admin read of the top 25 kept 4 usable
--                openings (trybe_directory_meta top100_hooks, 2026-10-17).
--   transcribed  Whisper on the video itself (lib/shorts-transcribe). Costs
--                money per video, works on every video that has a file.
--
-- COLLECTED ONCE, READ BY EVERYONE. Same model as top100_hooks: the MVP
-- team's own read fills this, every member reads it. A video is transcribed
-- once in the life of the product, not once per member.
--
-- A VIDEO WITH NO SCRIPT SAYS SO. `state` is never silently absent: 'none'
-- with a reason is a real answer, and the screen shows it rather than leaving
-- a gap that looks like a video nobody made.
--
-- Safe to run more than once.

create table if not exists public.trybe_top_scripts (
  -- TRYBE's submission id: the video, as TRYBE names it.
  submission_id text primary key,

  brand_id    text,
  brand_name  text,
  creator     text,
  -- Its best (lowest) place in the Top 100 while we have been watching.
  best_rank   integer,
  category    text,

  -- Where to watch it, and the still for the card.
  video_url   text,
  thumbnail   text,
  seconds     integer,

  -- The words.
  script      text,
  -- The opening line, cut from the script, for the hooks board.
  hook        text,
  -- trybe | transcribed | none
  source      text not null default 'none',
  -- ready   the script is here
  -- waiting nothing tried yet
  -- none    both sources were tried and neither had words; `detail` says so
  state       text not null default 'waiting',
  detail      text,

  first_seen  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists trybe_top_scripts_brand_idx on public.trybe_top_scripts (brand_id, best_rank);
create index if not exists trybe_top_scripts_state_idx on public.trybe_top_scripts (state) where state = 'waiting';
create index if not exists trybe_top_scripts_name_idx on public.trybe_top_scripts (brand_name);

-- Read by every signed in member, written only by MVP's server after it
-- checks the caller is the team.
alter table public.trybe_top_scripts enable row level security;

drop policy if exists "members read top scripts" on public.trybe_top_scripts;
create policy "members read top scripts" on public.trybe_top_scripts
  for select using (auth.uid() is not null);

notify pgrst, 'reload schema';
