-- 073 — Diagnostic counter for in-article images
--
-- When a post is generated with the "Include photos" checkbox ticked, the
-- after() block in /api/blog/generate runs image generation off the response
-- path. If anything fails silently (Hostinger WAF, fal hiccup, prompt empty,
-- after() didn't fire), the user has no way to tell why a post ended up
-- text-only without trawling Vercel logs. This column lets the after() block
-- write the actual count back to the row so the Content page can render a
-- small badge:
--
--   null  → image generation hasn't completed yet (or wasn't requested)
--   0     → generation ran but no images were inserted (real failure to chase)
--   >0    → that many in-body images were produced
--
-- Nullable on purpose so existing rows stay distinguishable from "ran with 0".

alter table public.blog_posts
  add column if not exists body_images_count integer;
