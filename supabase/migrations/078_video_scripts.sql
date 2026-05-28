-- 078 — AI-generated video scripts + shot lists
--
-- Pre-production tool: creator pastes an Amazon ASIN / product URL, picks a
-- style (Unboxing / Quick Test / Full Review), and Claude generates a
-- personalised script and shot list grounded in:
--   * the actual product info (Amazon scrape or generic page scrape)
--   * the creator's brand voice (writing_sample + tone + niches from
--     brand_profiles)
--   * a few of their recent post titles (to mirror their angle / hook style)
--
-- Each row stores the inputs + the generated output verbatim so creators
-- can come back to a script later, re-read it on their phone while
-- filming, or copy-paste sections without re-running the generator.
-- The output is stored as JSONB rather than rendered HTML so future
-- features (per-section regenerate, "rewrite this hook", PDF export)
-- can iterate on individual blocks without re-parsing markup.

create table if not exists public.video_scripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- One of 'unboxing' | 'quick_test' | 'full_review'. Drives the prompt
  -- skeleton — checked client + server-side so a stray value can't
  -- waste a Claude call.
  style text not null,
  -- Whatever the user typed: ASIN, Amazon URL, Geniuslink, brand-site
  -- URL. Kept verbatim for the "regenerate" / "Same product, different
  -- style" affordance.
  input text not null,
  -- Resolved at generation time; null when we couldn't extract one.
  -- Helpful for product-based caching down the line.
  asin text,
  product_title text,
  product_image_url text,
  -- The generated script — JSONB of section blocks. Shape:
  --   {
  --     "summary": "TL;DR of the video for the creator",
  --     "totalDurationSec": 480,
  --     "sections": [
  --       {
  --         "id": "hook",
  --         "label": "Hook",
  --         "durationSec": 15,
  --         "script": "what to say, verbatim",
  --         "shots": ["close-up of the product on a wooden table",
  --                   "talking head at chest-up framing"],
  --         "bRoll": ["product spinning on a turntable",
  --                   "macro of the texture"],
  --         "tips": ["lead with the boldest claim"]
  --       }, …
  --     ]
  --   }
  -- Stored as the raw Claude JSON so future features (per-section
  -- regen) can edit a single block without parsing markdown.
  script jsonb not null default '{}'::jsonb,
  -- The Claude model id used; lets us re-run with newer models cheaply
  -- by filtering rows on the older one.
  ai_model text,
  created_at timestamptz not null default now()
);
alter table public.video_scripts enable row level security;
drop policy if exists "Users manage own video scripts" on public.video_scripts;
create policy "Users manage own video scripts" on public.video_scripts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Newest-first listing on the script page.
create index if not exists video_scripts_user_created_idx
  on public.video_scripts (user_id, created_at desc);
