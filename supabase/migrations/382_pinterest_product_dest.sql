-- Migration 382: where product pins send people, and a Pinterest tracking ID.
--
-- Pinterest refuses short and redirect links (it blocked mvpl.ink), so a pin
-- goes to a page that is not a redirect. This is the creator's choice of which:
--   auto         the blog post about the product, else its Link in Bio
--                product page, else Amazon directly
--   blog_post    the blog post (then the same fallbacks)
--   link_in_bio  the product's own page on Link in Bio (then the fallbacks)
--   amazon       the full amazon.com product link with the creator's tag
--
-- pinterest_amazon_tag: an Amazon tracking ID used only on pins that go
-- straight to Amazon (for example yourtag-pin-20), so Amazon's reports show
-- what Pinterest earns. Empty means the main tag is used.
--
-- Safe to run twice.

alter table public.integrations
  add column if not exists pinterest_product_dest text not null default 'auto';

alter table public.integrations
  drop constraint if exists integrations_pinterest_product_dest_chk;
alter table public.integrations
  add constraint integrations_pinterest_product_dest_chk
  check (pinterest_product_dest in ('auto', 'blog_post', 'link_in_bio', 'amazon'));

alter table public.integrations
  add column if not exists pinterest_amazon_tag text;
