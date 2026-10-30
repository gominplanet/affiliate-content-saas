-- A-ROLL AND B-ROLL FOLDERS (Seb, 2026-10-30: "They should have a
-- predetermined folder that they use for, let's call it A roll and B roll").
-- Each creator's two Google Drive folders, remembered: { id, name }. Safe to
-- run twice.
alter table public.google_drive_links add column if not exists a_roll jsonb;
alter table public.google_drive_links add column if not exists b_roll jsonb;
