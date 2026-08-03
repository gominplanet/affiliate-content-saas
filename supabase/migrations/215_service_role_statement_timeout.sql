-- 215 — give the server (service_role) room to run the weekly catalog merge.
--
-- The catalog merge is already chunked + resumable, but every batch kept getting
-- "canceling statement due to statement timeout". Cause: the service_role (what
-- the admin/import endpoints run as) has a short statement_timeout, and a merge
-- batch that has to WAIT on a row lock held by the enrichment cron burns that
-- budget and gets cancelled — rolling the batch back, so it never progresses.
-- Batch size, SET LOCAL, and function-level SET can't fix it: the timeout clock
-- starts when the statement begins, from the ROLE setting. So raise the role
-- setting. This is Supabase's own documented way to change the API timeout
-- (ALTER ROLE ... SET statement_timeout + NOTIFY pgrst).
--
-- 180s is generous headroom for a single chunk (a chunk is thousands of rows,
-- seconds of work even while waiting out a cron lock) while still bounding a
-- genuinely stuck server query. service_role is SERVER-ONLY (never exposed to
-- browsers), so this does not widen anything a user can reach.
--
-- After this runs, the weekly flow is just: load the CSV into staging, click
-- Merge, done — no SQL editor, no direct connection, no timeout babysitting.
ALTER ROLE service_role SET statement_timeout = '180s';

NOTIFY pgrst, 'reload config';
