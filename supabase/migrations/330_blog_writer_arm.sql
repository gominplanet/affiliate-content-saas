-- 330: record which model wrote each blog post.
--
-- blog_generate is 36% of the AI bill. Sonnet 5 is 0.4x Opus on both rates, so
-- moving the writer there is about $1,150/yr — but the blog publishes to the
-- creator's own domain under their own name, so it is the one lever in the
-- audit that actually bets product quality.
--
-- blog_quality_checks already records a per-post prose signal (violations the
-- self-check found, how many fixes landed, how many concrete product numbers
-- made it in). Adding the writer turns that into a readable A/B: same table,
-- same signal, grouped by which model produced the draft. Without it the two
-- arms are indistinguishable and the trial can only be judged on taste.
--
-- Safe to run twice: both columns use `add column if not exists`, and the index
-- uses `create index if not exists`. Nothing is dropped or rewritten, existing
-- rows keep NULLs (they predate the trial, which is the honest value for them).

alter table public.blog_quality_checks
  add column if not exists writer_model text;

alter table public.blog_quality_checks
  add column if not exists writer_arm text;

-- The scoreboard query groups by arm over a date range, so this is the index it
-- wants. Partial: rows from before the trial carry NULL and are never grouped.
create index if not exists blog_quality_checks_writer_arm_idx
  on public.blog_quality_checks (writer_arm, created_at desc)
  where writer_arm is not null;
