-- Migration 158: store the last brand-outreach text
--
-- Alongside messaged_at (mig 157), keep the actual message that was sent so the
-- /epc "Messaged" history view can show what went out to each brand — not just
-- that something did. One column (the most recent send); enough for the history
-- list without a full per-message table.

alter table public.campaigns
  add column if not exists last_message text;
