-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 170 — store the Instagram *Business Account* id alongside the
-- app-scoped user id.
--
-- The Instagram API (with Instagram Login) OAuth returns an app-scoped user_id
-- (e.g. 36292…) which MVP uses for publishing. But the comment/messaging WEBHOOK
-- can carry the account's *Business Account* id (e.g. 17841…) in entry.id. They
-- differ for the same account, so the IG comment→DM webhook must be able to
-- resolve the owner by EITHER id. This column holds the business id; the webhook
-- lookup matches instagram_user_id OR instagram_business_id.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.integrations
  add column if not exists instagram_business_id text;
