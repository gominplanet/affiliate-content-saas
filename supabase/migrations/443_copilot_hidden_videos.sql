-- © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
--
-- Co-Pilot: videos a creator hid from the list (Seb, 2026-10-19: "be able to
-- delete (or dismiss an entry) so that particular video is not being recalled
-- on the list again"). YouTube video ids, newest last. The video itself is
-- never touched: this only keeps it off MVP's list.
--
-- Safe to run twice.
alter table public.integrations add column if not exists copilot_hidden_videos text[] not null default '{}';
notify pgrst, 'reload schema';
