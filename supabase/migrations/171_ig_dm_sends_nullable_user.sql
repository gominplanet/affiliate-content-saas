-- Migration 171 — allow ig_dm_sends rows with no user_id, so the webhook can log
-- a diagnostic "received but couldn't resolve the account" row (the id-mismatch
-- case that otherwise leaves no trace, making a first-test miss undebuggable).
alter table public.ig_dm_sends alter column user_id drop not null;
