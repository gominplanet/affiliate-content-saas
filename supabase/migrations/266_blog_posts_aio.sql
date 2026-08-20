-- © 2026 Gominplanet / MVP Affiliate
--
-- Migration 266 — persist the AIO (AI-answer readiness) score on each post.
--
-- The generator scores every published post for how quotable it is by AI answer
-- engines (see lib/aio-score) and stores the result here so the composer and
-- Content Library can badge it without re-scoring. jsonb holds { score, grade,
-- checks[] }. Code writes it best-effort, so a DB without this column never fails
-- a publish.

alter table if exists public.blog_posts
  add column if not exists aio jsonb;
