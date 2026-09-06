-- 315 — The products a joined campaign actually covers.
--
-- A Creator Connections campaign can span a dozen ASINs, and MVP only reliably
-- knew one: the shared catalog's asins column is empty for a large share of
-- campaigns, so the browse page recovers a single ASIN from the campaign's NAME
-- and every screen downstream inherits that one product as though it were the
-- whole campaign. The creator was then shown one product to make content for and
-- never told the other eleven existed.
--
-- Amazon's own campaign page lists them, and SCOUT can read it, but a campaign
-- eventually falls out of the live catalog and off the creator's Amazon list, so
-- the answer has to be kept rather than re-fetched forever. This is where it
-- lives, per creator and per campaign row.
alter table public.campaigns
  add column if not exists campaign_asins text[];

notify pgrst, 'reload schema';
