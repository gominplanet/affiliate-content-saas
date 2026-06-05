-- 096_brand_contact_channels.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Adds the three additional reach-out channels creators commonly hand to
-- brand contacts: WhatsApp (international), WeChat (China), Lark
-- (China/Asia, ByteDance's enterprise messenger). Sits next to
-- contact_email (migration 010) on brand_profiles so the Collaborations
-- generator can offer brands more than one way to reply.
--
-- All three are optional. If filled, they show up in the email's "Best
-- ways to reach me" sign-off block. If blank, that line is skipped.

alter table public.brand_profiles
  add column if not exists contact_whatsapp text,
  add column if not exists contact_wechat   text,
  add column if not exists contact_lark     text;
