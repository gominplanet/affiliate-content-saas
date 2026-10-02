-- What SCOUT set and read back when it uploaded a Liftoff video through
-- YouTube Studio (lib/studio-upload): text, tags, thumbnail, playlist and the
-- visibility it saved. The drain skips each item SCOUT did, after checking it
-- with one 1-unit read, and does only the ones it did not, so a Studio upload
-- costs almost nothing from the shared YouTube quota.
-- Safe to run twice.
alter table public.launch_items add column if not exists studio_upload jsonb;
