-- ── 445: social posts scheduled from a member's own Deals Hub file ────────
-- Seb, 2026-10-19: deals imported from the Deals Hub file go to Pinterest,
-- Facebook, Instagram and the rest, scheduled for when each deal starts.
-- Deal Radar never carried these deals, so the row keeps the deal as the file
-- gave it (title, brand, image, discount, start and end), and the
-- process-deal-schedules cron decides "live" from that window. Safe to run
-- twice.

alter table public.deal_scheduled_posts add column if not exists deal_known jsonb;

notify pgrst, 'reload schema';
