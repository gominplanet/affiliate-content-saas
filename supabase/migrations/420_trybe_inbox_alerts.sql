-- 420: TRYBE reply alerts (TRYBE Outreach). MVP's server cannot reach TRYBE,
-- so each time SCOUT reads the creator's TRYBE inbox the page notes how many
-- messages are unread, from whom, and when it looked. The menu count and the
-- Today list read this note, and show it only while it is recent.
-- Safe to run twice.
alter table public.trybe_outreach_settings add column if not exists inbox_unread integer;
alter table public.trybe_outreach_settings add column if not exists inbox_unread_names text[] not null default '{}';
alter table public.trybe_outreach_settings add column if not exists inbox_checked_at timestamptz;
notify pgrst, 'reload schema';
