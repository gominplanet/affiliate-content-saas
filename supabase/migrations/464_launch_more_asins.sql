-- Up to three products tagged on one Amazon video (Bulk Amazon upload).
-- The first product stays in launch_items.asin. The other two (the exact
-- products, never a parent ASIN) are kept here and tagged on the Amazon video
-- by SCOUT 1.55.0 and later. Safe to run twice.
alter table public.launch_items
  add column if not exists more_asins text[] not null default '{}';
