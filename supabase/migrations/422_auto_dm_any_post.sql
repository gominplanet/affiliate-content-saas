-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 422: Auto-DM on any post, a backup link, and no STOP line.
--
-- any_post      a keyword comment on a post MVP did not publish also gets a DM
--               (default on: most creators post from the Instagram app).
-- fallback_link what those posts send; empty means the Link in Bio shop.
--
-- The default message promised "Reply STOP to opt out" and nothing read the
-- replies, so the line comes out of the default and of saved messages.
--
-- The temporary Facebook breadcrumb rows (comment_id 'diag-...', one per Page
-- event, about 850 of them) are removed; the real DM rows stay.
--
-- Safe to run twice.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.ig_dm_settings add column if not exists any_post boolean not null default true;
alter table public.ig_dm_settings add column if not exists fallback_link text;

alter table public.ig_dm_settings alter column message_template set default E'Here you go \U0001F517 {link}';

update public.ig_dm_settings
   set message_template = btrim(regexp_replace(message_template, '\s*reply\s+stop\s+to\s+opt\s+out\.?', '', 'gi'))
 where message_template ~* 'reply\s+stop\s+to\s+opt\s+out';

delete from public.ig_dm_sends where comment_id like 'diag-%';
