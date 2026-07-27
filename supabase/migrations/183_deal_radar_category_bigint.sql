-- 183 — Deal Radar: category_id must be bigint, not integer.
--
-- Amazon browse-node (category) IDs exceed the 32-bit integer max (~2.1B) —
-- e.g. Patio & Garden = 2972638011, Toys & Games = 165793011, Pet Supplies =
-- 2619533011. Storing/filtering those as `integer` throws
-- "value out of range for type integer": the category filter errored, and the
-- refresh cron silently dropped whole chunks that contained a big-ID deal.
ALTER TABLE deal_radar_cache
  ALTER COLUMN category_id TYPE bigint;
