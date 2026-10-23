-- Migration 454: Auto-DM on every Instagram post MVP makes (lib/ig-auto-dm).
--
-- Seb, 2026-10-23: "anywhere a user can use instagram, this auto dm feature
-- should be set up and ready to use". Every Reel and feed post MVP publishes
-- (Clip Factory, Shorts, blog posts, Amazon and deal posts, the Instagram
-- burner, schedules) gets its own ig_dm_campaigns row with its own link and
-- the creator's keyword. This is the creator's switch for that, on unless
-- they turn it off on the Instagram Auto-DM page. Read with select('*'), so
-- before this runs every creator reads as on and only saving the switch off
-- is held back.
--
-- Safe to run twice.
alter table public.ig_dm_settings add column if not exists mvp_posts boolean not null default true;

notify pgrst, 'reload schema';
