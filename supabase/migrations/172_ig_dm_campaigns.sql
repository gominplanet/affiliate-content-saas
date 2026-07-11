-- Migration 172 — per-post Instagram auto-DM campaigns.
--
-- The global ig_dm_settings (mig 169) DMs each MVP-published post its OWN
-- resolved affiliate link when a commenter says the global keyword. This adds
-- STANDALONE campaigns: the creator uploads a vertical video + an affiliate link
-- + a trigger word, MVP publishes it as a Reel and stores this row keyed by the
-- resulting IG media id. When that word is commented on THAT reel, we DM that
-- exact link — independent of blog posts, and with a per-campaign keyword/link.
create table if not exists public.ig_dm_campaigns (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  ig_media_id   text unique,          -- the published Reel's media id (null until publish returns)
  keyword       text not null default 'LINK',
  link          text not null,        -- the affiliate/Geniuslink DM'd on a keyword match
  product_name  text,
  caption       text,                 -- the caption MVP composed + published
  video_url     text,                 -- public https source we handed to IG
  status        text not null default 'active',  -- active | publishing | failed | disabled
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists ig_dm_campaigns_user_idx on public.ig_dm_campaigns (user_id);
create index if not exists ig_dm_campaigns_media_idx on public.ig_dm_campaigns (ig_media_id);

alter table public.ig_dm_campaigns enable row level security;

drop policy if exists "own ig_dm_campaigns" on public.ig_dm_campaigns;
create policy "own ig_dm_campaigns" on public.ig_dm_campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
