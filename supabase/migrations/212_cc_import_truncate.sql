-- 212 — instant staging reset.
--
-- "Clear staging first" ran a DELETE over the whole cc_campaign_catalog_import
-- table (~800k rows). That's slow and blew the API function timeout, so the
-- upload hung at 0% before a single new row could land. TRUNCATE is instant but
-- can't be issued through PostgREST, so expose it as a SECURITY DEFINER RPC.
CREATE OR REPLACE FUNCTION truncate_cc_import()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  TRUNCATE TABLE cc_campaign_catalog_import;
END $$;

NOTIFY pgrst, 'reload schema';
