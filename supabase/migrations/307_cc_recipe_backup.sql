-- 307_cc_recipe_backup.sql
-- Durable backup of SCOUT's learned Creator Connections send/search "recipe".
--
-- SCOUT learns Amazon's chat send + token-lookup request shapes from one real
-- send and keeps them in the extension's own storage. That storage is wiped when
-- a creator switches SCOUT builds (sideloaded vs the Chrome Web Store version are
-- different extension ids with separate storage) or reinstalls — which forced a
-- fresh "message one brand by hand" every time. We now mirror the learned recipe
-- to the creator's MVP account so any install/update re-hydrates it automatically
-- and never forgets.
--
-- We store ONLY the request TEMPLATES (method, url, body template with the
-- content/contextToken/campaignId placeholders) — never cookies or auth headers;
-- the replay is cookie-authed from the creator's own live Amazon session.

alter table public.integrations
  add column if not exists cc_send_recipe jsonb,
  add column if not exists cc_search_recipe jsonb;

notify pgrst, 'reload schema';
