-- Per-user external API keys for Labs integrations (Levanta, PartnerBoost, and
-- any future external feature). One row per (user, provider); the key is stored
-- ENCRYPTED (lib/secrets). Generic by design so new providers need NO migration —
-- just add the provider id to lib/external-keys.ts.
CREATE TABLE IF NOT EXISTS external_api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  encrypted_key text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

ALTER TABLE external_api_keys ENABLE ROW LEVEL SECURITY;

-- Owner-only. The key value is never selectable by anyone but the owner, and
-- routes only ever return a masked last-4 — never the decrypted key.
CREATE POLICY "external_api_keys owner select" ON external_api_keys
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "external_api_keys owner insert" ON external_api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "external_api_keys owner update" ON external_api_keys
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "external_api_keys owner delete" ON external_api_keys
  FOR DELETE USING (auth.uid() = user_id);
