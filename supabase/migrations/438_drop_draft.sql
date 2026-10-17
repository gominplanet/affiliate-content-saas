-- 438 Drop: the drop being set up is kept, so the page can be reloaded while
-- videos upload and Liftoff prepares them (Seb, 2026-10-17: "we need every
-- single setting included in this one page").
--
-- A drop in state 'draft' is the one on the page right now. Each video's
-- choices before Launch (where it goes, its caption, its TikTok choices) are
-- kept in `wish`, so a reload shows what the creator picked rather than the
-- plan again. Nothing reads a draft but the Drop page: SCOUT's background tab
-- and the steps leave it alone until Launch.
--
-- Safe to run more than once.

alter table public.drop_items add column if not exists wish jsonb not null default '{}'::jsonb;

create index if not exists drops_draft_idx on public.drops (user_id) where state = 'draft';

notify pgrst, 'reload schema';
