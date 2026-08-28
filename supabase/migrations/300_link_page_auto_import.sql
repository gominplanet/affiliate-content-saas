-- 300 — Link in Bio: auto-import products from Clip Factory posts.
--
-- Opt-in per creator. When on, publishing a Short to TikTok / Instagram through
-- Clip Factory (the Direct Post endpoints) appends that product as a tile on the
-- creator's shop page automatically, so they don't have to click "Import my
-- posted products". Off by default — nothing changes for existing pages until the
-- creator flips the toggle.
ALTER TABLE link_pages
  ADD COLUMN IF NOT EXISTS auto_import_posts boolean NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
