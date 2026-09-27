-- Migration 380: the on/off switch for Ended deals running on its own.
--
-- When on (the default), a job every six hours turns deal posts whose sale
-- ended into lasting reviews, and brings the deal back on a lasting review
-- whose product is on sale again. Off leaves every post as it is; the page
-- still lists them and the buttons still work.
--
-- Safe to run twice.

alter table public.integrations
  add column if not exists deal_aftercare_auto boolean not null default true;
