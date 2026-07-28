-- 192 — Link in Bio: flag product tiles that are "live in my story".
--
-- Stories last 24h, so a creator marks which imported deals are currently in
-- their IG/TikTok story. Those render in a "Current deals" section on the public
-- page (and are the set we generate stories from); the rest fall under a
-- "More sales I found" section.

ALTER TABLE link_page_items
  ADD COLUMN IF NOT EXISTS in_story boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
