-- 425: TRYBE playbook (Cole's interview, Seb 2026-10-12).
--
-- On MVP's shared copy of TRYBE (trybe_directory), the signals that pick a
-- brand worth working with:
--   tiktok_handle / tiktok_shop / socials_checked_at  read from the brand's own
--     website: a brand on TikTok Shop has more creators competing.
--   meta_ads / meta_ads_checked_at  how many active Meta ads mention the brand,
--     read by SCOUT from Meta's Ad Library: proof it spends on ads.
--   top100_hits / top100_best_rank / top100_checked_at  how often the brand is
--     in TRYBE's own Top 100 videos right now.
--   earnings_bucket  what TRYBE says creators earn with the brand.
--
-- On each creator's own list (trybe_brands), what happens after a brand
-- accepts: the first message (kickoff), when it went, and the video plan
-- (one body, many hooks).
--
-- Safe to run twice.

alter table public.trybe_directory add column if not exists tiktok_handle text;
alter table public.trybe_directory add column if not exists tiktok_shop boolean;
alter table public.trybe_directory add column if not exists socials_checked_at timestamptz;
alter table public.trybe_directory add column if not exists meta_ads integer;
alter table public.trybe_directory add column if not exists meta_ads_checked_at timestamptz;
alter table public.trybe_directory add column if not exists top100_hits integer not null default 0;
alter table public.trybe_directory add column if not exists top100_best_rank integer;
alter table public.trybe_directory add column if not exists top100_checked_at timestamptz;
alter table public.trybe_directory add column if not exists earnings_bucket text;

-- What TRYBE already sent for each brand, where it carries an earnings bucket.
update public.trybe_directory
   set earnings_bucket = left(coalesce(raw->>'creatorEarningsBucket', raw->>'creator_earnings_bucket', raw->'brand'->>'creatorEarningsBucket'), 60)
 where earnings_bucket is null
   and coalesce(raw->>'creatorEarningsBucket', raw->>'creator_earnings_bucket', raw->'brand'->>'creatorEarningsBucket') is not null;

-- Websites already read get their TikTok check on the next background pass.
create index if not exists trybe_directory_socials_idx
  on public.trybe_directory (trybe_score desc nulls last) where socials_checked_at is null and website is not null;

alter table public.trybe_brands add column if not exists kickoff_draft text;
alter table public.trybe_brands add column if not exists kickoff_sent_at timestamptz;
alter table public.trybe_brands add column if not exists followup_sent_at timestamptz;
alter table public.trybe_brands add column if not exists video_plan jsonb;
alter table public.trybe_brands add column if not exists video_plan_at timestamptz;

notify pgrst, 'reload schema';
