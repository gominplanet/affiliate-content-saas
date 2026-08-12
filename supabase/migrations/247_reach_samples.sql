-- Migration 247: reach_samples — the performance-learning collector.
--
-- Every Reel/Short MVP publishes drops a row here (status 'pending') with the
-- hashtags it used and the product niche. A follow-up job pulls that post's
-- Instagram insights a day or so later and fills reach/plays/etc, then computes
--   lift = reach / the account's OWN median reach at that time
-- so a small creator's win counts as much as a big account's — we rank tags by
-- how far they beat the poster's baseline, never by raw view counts.
--
-- The rows carry (niche, hashtags, lift) so tag performance can be ranked two
-- ways off the SAME data:
--   • personal — this user's own history
--   • pooled   — aggregated across ALL users, sliced by niche (the network
--                effect that gives brand-new users good tags on day one)
--
-- Privacy: only the aggregated tag→lift signal is ever shared between users.
-- One user never sees another's posts or numbers. Cross-user aggregation runs
-- through the service-role client; a user can read only their own rows (RLS).

create table if not exists public.reach_samples (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null,
  platform              text not null default 'instagram',
  media_id              text,                 -- IG media id, for the insights pull
  niche                 text,                 -- product category (hashtag engine)
  hashtags              text[] not null default '{}',
  posted_at             timestamptz not null default now(),

  -- Filled by the insights job (null until collected):
  reach                 integer,
  plays                 integer,
  likes                 integer,
  comments              integer,
  saves                 integer,
  shares                integer,
  account_median_reach  numeric,              -- the user's median reach when scored
  lift                  numeric,              -- reach / account_median_reach

  status                text not null default 'pending', -- pending|collected|failed|skipped
  attempts              integer not null default 0,
  fetched_at            timestamptz,
  created_at            timestamptz not null default now()
);

-- Personal panel: newest samples per user.
create index if not exists reach_samples_user_idx on public.reach_samples (user_id, posted_at desc);
-- The insights job: find rows still awaiting a pull.
create index if not exists reach_samples_pending_idx on public.reach_samples (status, posted_at) where status = 'pending';
-- Pooled ranking: scored rows by niche.
create index if not exists reach_samples_niche_idx on public.reach_samples (niche) where lift is not null;

alter table public.reach_samples enable row level security;

-- Users read only their OWN samples (drives the personal "your best hashtags"
-- view). All writes and the cross-user pooled aggregation go through the
-- service-role client, which bypasses RLS.
drop policy if exists reach_samples_own_read on public.reach_samples;
create policy reach_samples_own_read on public.reach_samples
  for select using (auth.uid() = user_id);
