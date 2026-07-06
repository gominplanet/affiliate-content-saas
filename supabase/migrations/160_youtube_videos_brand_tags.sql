-- Per-video brand tags/keywords the creator was asked to include by a brand.
-- Up to 5, comma-separated. Inserted VERBATIM at the very top of the generated
-- blog post (no LLM in the loop). Set via the input next to the category
-- dropdown on the Content page; read by /api/blog/generate.
ALTER TABLE youtube_videos ADD COLUMN IF NOT EXISTS brand_tags text;
