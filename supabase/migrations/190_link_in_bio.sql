-- 190 — Link in Bio (affiliate "Shop Grid" / Start Page).
--
-- A public, hosted link-in-bio page per creator at /s/<handle>. A grid of
-- shoppable product tiles, each linking through the creator's affiliate URL
-- (Geniuslink-wrapped when configured). Auto-populated from the products they've
-- already posted (product_watches), plus manual tiles. One page per user (v1).
--
-- The public page is rendered server-side with the service-role client, so RLS
-- here is owner-only — no public policy needed.

CREATE TABLE IF NOT EXISTS link_pages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  handle      text NOT NULL UNIQUE,                 -- URL slug: /s/<handle>
  title       text,
  bio         text,
  avatar_url  text,
  theme       text NOT NULL DEFAULT 'light',        -- light | dark | sunset | forest | ocean
  published   boolean NOT NULL DEFAULT false,
  clicks      integer NOT NULL DEFAULT 0,           -- lifetime tile clicks
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)                                  -- one page per user (v1)
);

CREATE TABLE IF NOT EXISTS link_page_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id     uuid NOT NULL REFERENCES link_pages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  image_url   text,
  url         text NOT NULL,                        -- destination (affiliate)
  asin        text,                                 -- source product, if any
  source      text NOT NULL DEFAULT 'manual',       -- manual | deal
  position    integer NOT NULL DEFAULT 0,
  hidden      boolean NOT NULL DEFAULT false,
  clicks      integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Prevents duplicate auto-imports of the same product. NULLs are distinct in
  -- Postgres, so any number of manual (asin IS NULL) tiles are still allowed.
  UNIQUE (page_id, asin)
);

CREATE INDEX IF NOT EXISTS link_page_items_page_pos_idx ON link_page_items (page_id, position);

ALTER TABLE link_pages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE link_page_items  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own link_pages" ON link_pages;
CREATE POLICY "own link_pages" ON link_pages
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "own link_page_items" ON link_page_items;
CREATE POLICY "own link_page_items" ON link_page_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';
