-- Migration 448: hashtags MVP wants counted on Instagram.
--
-- Seb, 2026-10-20: "Do we actually go online to find and pick the winning
-- hashtags? ... I love a hashtag that is anywhere between 10,000 and 200,000".
-- Each caption's possible tags are found and counted on YouTube as it is
-- written (lib/hashtag-research). Instagram's counts need a signed-in
-- browser, so the tags Instagram has not counted are kept here, and SCOUT
-- reads them quietly through an Instagram tab the creator has open. Shared
-- across members, like hashtag_trends; only MVP's server reads or writes it.
--
-- Safe to run twice.
create table if not exists public.hashtag_wanted (
  platform text not null,
  tag text not null,
  wanted_at timestamptz not null default now(),
  primary key (platform, tag)
);
create index if not exists hashtag_wanted_recent on public.hashtag_wanted (platform, wanted_at desc);
alter table public.hashtag_wanted enable row level security;
notify pgrst, 'reload schema';
