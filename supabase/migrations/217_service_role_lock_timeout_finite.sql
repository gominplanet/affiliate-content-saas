-- 217 — walk back 216's lock_timeout = 0 to a finite value.
--
-- 216 set lock_timeout = 0 so the merge would WAIT through a brief lock held by
-- the enrichment cron. But 216 ALSO added the pause flag that stops the cron
-- during an import, so there's nothing to wait for anymore — and lock_timeout=0
-- means "wait forever", so any stray lock now hangs the batch until the Supabase
-- HTTP gateway kills the request ("upstream request timeout"). A finite
-- lock_timeout makes a batch fail FAST and resumably instead of hanging the HTTP
-- call. statement_timeout stays at 180s (215); this only bounds lock waits.
ALTER ROLE service_role SET lock_timeout = '15s';

NOTIFY pgrst, 'reload config';
