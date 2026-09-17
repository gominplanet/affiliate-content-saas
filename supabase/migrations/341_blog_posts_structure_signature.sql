-- 341: record each post's body shape, so the next one can avoid repeating it.
--
-- The writer prompt carried a fixed seven-section template, A through G, in one
-- order, on every post. It also carried an instruction saying no two posts may
-- have the same shape. The template won, because a model given an abstract rule
-- and a concrete template follows the template. At 279 posts a site was one page
-- with the nouns swapped, which is exactly what Google's near-duplicate handling
-- is built to catch.
--
-- lib/post-structure.ts now chooses a shape per post. This column is what makes
-- that check real rather than probable: without a record of what shipped, the
-- planner can vary every post and still land on the shape used last week.
--
-- Format is "hook>performance>friction>advice|vsp", the ordered section keys and
-- the optional blocks that were switched on. Nullable, because every post
-- written before this exists has no signature and must not be guessed at.
--
-- Safe to run more than once.

alter table public.blog_posts
  add column if not exists structure_signature text;

comment on column public.blog_posts.structure_signature is
  'Body shape of this post: ordered section keys plus enabled blocks. Compared against recent posts so no two share a structure. Null for posts generated before 2026-09-17.';

-- The planner reads the most recent signatures for one user. Partial index
-- because rows without a signature are never the thing being looked up.
create index if not exists blog_posts_structure_sig_idx
  on public.blog_posts (user_id, created_at desc)
  where structure_signature is not null;
