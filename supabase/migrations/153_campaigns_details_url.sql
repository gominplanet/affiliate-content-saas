-- Migration 153: remember each campaign's Amazon page so MVP can message the brand
--
-- To "Message brand" from the MVP /epc list (where the user isn't on Amazon),
-- MVP has to tell SCOUT which page to open. SCOUT knows the campaign's Creator
-- Connections details URL at import time, so we store it here; MVP later hands it
-- back to SCOUT (via the extension bridge) to open the brand's message box.

alter table public.campaigns
  add column if not exists details_url text;
