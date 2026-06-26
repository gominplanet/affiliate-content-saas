-- Brand-recap link hardening: store the REAL public permalink each social
-- platform hands back at post-time, so the "here's where our review is live"
-- message links exactly where the post landed — including platforms (Threads,
-- Instagram, Telegram) that have no reliable public URL derivable from the
-- opaque post id alone. Map of platform -> url; written best-effort by
-- lib/social-permalink.ts, preferred by lib/brand-recap.ts buildRecapLinks().
ALTER TABLE blog_posts
  ADD COLUMN IF NOT EXISTS social_permalinks jsonb;
