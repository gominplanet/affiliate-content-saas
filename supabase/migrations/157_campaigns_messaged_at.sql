-- Migration 157: record when a brand was messaged
--
-- After SCOUT sends the brand-outreach for a campaign, MVP stamps messaged_at so
-- the /epc list shows which products/campaigns you've already reached out to
-- (a "✓ Messaged" badge) — the record the user was missing after a send.

alter table public.campaigns
  add column if not exists messaged_at timestamptz;
