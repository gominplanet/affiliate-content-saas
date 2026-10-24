-- 457: when the TRYBE core message was last changed (Labs).
--
-- A join request is the core message nearly word for word. Drafts written
-- before the core message last changed are marked in Ready to send ("written
-- from your earlier core message"), with Rewrite, so a creator never sends
-- the old words without knowing (TRYBE review, 2026-10-24). Set by the
-- server when Save message changes the words; empty until then, and empty
-- means nothing is marked.
--
-- Safe to run twice.

alter table public.trybe_outreach_settings add column if not exists core_saved_at timestamptz;

notify pgrst, 'reload schema';
