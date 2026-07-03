-- Migration 155: saved Outreach Profile for brand messaging
--
-- One reusable profile that drives every Creator Connections "Message Brand"
-- draft (SCOUT ✍️ Draft + the /epc Message modal) so the creator fills their
-- greeting / credibility / offer / categories / portfolio links / sample
-- shipping details ONCE and every message replicates them — matching their
-- proven multi-message ("Add to Message Group") template without hand-editing.
--
-- Stored as one JSON blob (flexible; no column churn as the field set evolves):
--   {
--     greetingStyle, intro, offer, categories[],
--     youtube, blog, linktree, storefrontUrl,
--     shipName, shipAddress, phone, email, signoff
--   }
-- Lives on brand_profiles (per-user, already created at onboarding). It holds
-- the creator's own PII (ship name/address/phone) — same table as their other
-- contact fields; RLS already scopes brand_profiles to the owner.

alter table public.brand_profiles
  add column if not exists outreach_profile jsonb;
