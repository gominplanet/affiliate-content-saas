-- Migration 446: how many copies of SCOUT a member's Chrome has.
--
-- Two copies (one from the Chrome Web Store, one added by hand) took turns
-- answering MVP: TRYBE asked to be allowed again on every visit and sends went
-- through the old copy with its old error (Alejandro, 2026-10-19). MVP now
-- always talks to the newest copy and the banner says when there are two
-- (lib/scout-copies). This keeps the list, so an admin can see it too:
-- [{ "id": "...", "version": "1.53.0", "store": true }, ...].
--
-- Written by the server only (service role). Safe to run twice.

alter table public.integrations add column if not exists scout_copies jsonb;

notify pgrst, 'reload schema';
