-- 068_blog_post_type.sql
-- Multi-product feature: tag blog posts as a single review (default) vs a
-- multi-product comparison or buying guide, so the new Comparisons section can
-- list them separately. Safe to paste in full — idempotent, default keeps every
-- existing post as 'review'.

alter table public.blog_posts
  add column if not exists post_type text not null default 'review';
