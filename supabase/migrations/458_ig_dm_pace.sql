-- Migration 458: auto-DMs at a human pace (lib/ig-pace, Seb 2026-10-26).
-- When each DM actually went (not when its comment came in), and when a DM
-- that waits its turn is due. Safe to run twice.
alter table public.ig_dm_sends add column if not exists sent_at timestamptz;
alter table public.ig_dm_sends add column if not exists send_after timestamptz;
create index if not exists ig_dm_sends_queue_idx on public.ig_dm_sends (send_after) where status = 'queued';
create index if not exists ig_dm_sends_sent_idx on public.ig_dm_sends (user_id, sent_at desc) where status = 'sent';
notify pgrst, 'reload schema';
