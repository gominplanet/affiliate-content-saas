-- User-designed CTA boxes (Shop Burner "Make one from text"). Each row is a
-- transparent badge PNG the creator generated, kept so they can reuse it across
-- sessions instead of regenerating (which costs ~$0.14). The PNG itself lives
-- in Supabase Storage (bucket instagram-videos, {user_id}/cta-*.png); this table
-- just indexes the public URL + the tag it was made from.
CREATE TABLE IF NOT EXISTS cta_stickers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url         text NOT NULL,
  tag         text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cta_stickers_user_created_idx
  ON cta_stickers (user_id, created_at DESC);

ALTER TABLE cta_stickers ENABLE ROW LEVEL SECURITY;

-- Owner-only across the board (private to the creator who designed them).
CREATE POLICY "cta_stickers owner select" ON cta_stickers
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "cta_stickers owner insert" ON cta_stickers
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "cta_stickers owner delete" ON cta_stickers
  FOR DELETE USING (auth.uid() = user_id);
