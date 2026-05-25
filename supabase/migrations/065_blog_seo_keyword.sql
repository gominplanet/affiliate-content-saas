-- Migration 065: transcript-grounded SEO fields on blog_posts (Phase 2 / Track A)
--
-- The blog generator now derives a focus keyword (the search phrase a real
-- buyer would type, grounded in the transcript + product facts) and a click-
-- optimised meta description that leads with it. We persist both so the
-- re-optimise loop (Phase 4) can read what each post was targeting.
--
-- Both are additive + nullable. The route writes them best-effort AFTER the
-- core post save, so deploying this app build before running this migration
-- is safe (the write simply no-ops until the columns exist). The rendered
-- <head> meta description does NOT depend on these columns — it's written via
-- WordPress post meta.

alter table public.blog_posts
  add column if not exists seo_keyword text,
  add column if not exists meta_description text;
