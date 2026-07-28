-- 191 — Link in Bio: brand "links" (Linktree-style) alongside product tiles.
--
-- A link_page_item is now either a shoppable PRODUCT (grid tile) or a brand LINK
-- (full-width button: YouTube, Instagram, TikTok, blog, …). `kind` distinguishes
-- them; `icon` is a platform slug the UI maps to a brand icon; `subtitle` is an
-- optional second line on a link button.

ALTER TABLE link_page_items
  ADD COLUMN IF NOT EXISTS kind     text NOT NULL DEFAULT 'product',  -- 'product' | 'link'
  ADD COLUMN IF NOT EXISTS icon     text,                            -- platform slug for links
  ADD COLUMN IF NOT EXISTS subtitle text;

NOTIFY pgrst, 'reload schema';
