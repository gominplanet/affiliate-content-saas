-- 344 — blog_posts.pin_design: which pin actually went out, not which one we meant to send
--
-- A scheduled pin went live in the old photo-scene look while the three before
-- it carried the account's designed Art Director layout. Nothing errored.
-- Nothing logged. buildPinAssets returns an imageBase64 for the designed pin
-- AND for every fallback, so every caller read "we got bytes" as success, and
-- the two outcomes were the same shape all the way to Pinterest.
--
-- Four different things silently downgrade a pin, and only one of them wrote a
-- log line. The worst is the quietest: when no real product photo resolves for
-- the post, the designed branch is skipped by its own `if`, so there is no
-- exception to catch and nothing to report.
--
-- This column is the answer to "how often does that happen, and to whom",
-- which until now could only be answered by scrolling Vercel logs and guessing.
-- It stores what PRODUCED the image, plus why it was not the designed one:
--
--   art-director                              the designed single-product pin
--   art-director-collage                      the designed comparison grid
--   composite-thumbnail:no-product-reference  the post hero, because no product
--                                             photo could be resolved
--   scene-overlay:art-director-returned-null  a fresh scene, because the
--                                             designed render failed
--   collage-fallback:roundup-needs-two-photos name-only grid, too few photos
--
-- Nullable, and null is honest: every pin published before this has no record,
-- and a null must not be read as "designed". The publishing code treats a write
-- failure here as non-fatal, so applying it late breaks nothing and applying it
-- is what makes the reporting real.
--
-- Safe to run twice.

alter table public.blog_posts
  add column if not exists pin_design text;

comment on column public.blog_posts.pin_design is
  'How this post''s Pinterest pin was actually produced, plus why it was not the designed one (e.g. composite-thumbnail:no-product-reference). Null means the pin predates this column, NOT that it was designed. See lib/pin-design-outcome.ts';

-- Partial: rows with no pin are never the thing being counted.
create index if not exists blog_posts_pin_design_idx
  on public.blog_posts (user_id, pin_design)
  where pin_design is not null;
