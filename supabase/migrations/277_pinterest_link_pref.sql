-- 277 — Where a Clip Factory Pinterest pin should link.
--
-- The video-pin cross-post used to always link to the blog homepage, then we
-- made it smart (blog post → source video → homepage). This lets each creator
-- choose their own default instead:
--   'auto'      — blog post for the clip's video if one exists, else the
--                 YouTube video, else the blog homepage (the smart default)
--   'blog_post' — the blog post for the video (else the homepage)
--   'youtube'   — the YouTube video the clip came from (else the homepage)
--   'homepage'  — always the creator's blog homepage
-- Never an affiliate redirect (Pinterest + Amazon ToS). Idempotent.

alter table public.integrations
  add column if not exists pinterest_link_pref text not null default 'auto';

alter table public.integrations
  drop constraint if exists integrations_pinterest_link_pref_chk;
alter table public.integrations
  add constraint integrations_pinterest_link_pref_chk
  check (pinterest_link_pref in ('auto', 'blog_post', 'youtube', 'homepage'));

comment on column public.integrations.pinterest_link_pref is
  'Where a Clip Factory Pinterest video pin links: auto | blog_post | youtube | homepage.';

notify pgrst, 'reload schema';
