-- Migration 014: Add Telegram integration columns
--
-- Telegram fan-out uses a single shared MVP Affiliate bot (token in
-- TELEGRAM_BOT_TOKEN env var) that each user adds as an admin to their
-- own channel. We only need to store the user's channel id — bot
-- authentication is shared and lives server-side.
--
-- channel_id stores either the public username form ("@theirchannel")
-- or the numeric form ("-1001234567890"). Telegram's Bot API accepts
-- both for sendPhoto/sendMessage.
--
-- channel_title is a cached display string ("MVP Reviews") so the
-- Integrations page can show what's connected without an extra
-- getChat API round trip every time the page loads.

alter table public.integrations
  add column if not exists telegram_channel_id    text,
  add column if not exists telegram_channel_title text;

alter table public.blog_posts
  add column if not exists telegram_message_id text;
