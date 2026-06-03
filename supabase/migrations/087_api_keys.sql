-- Migration 087 — API keys for Pro-tier programmatic access.
--
-- Each Pro user can mint multiple API keys (label them per integration: "Zapier",
-- "internal automation", "n8n", etc.). The plaintext key is shown ONCE on creation
-- and never stored — we only persist a SHA-256 hash. Bearer-token auth on
-- /api/v1/* routes hashes the incoming token and looks it up here.
--
-- Format: `mvp_live_<32 random url-safe chars>` (shows source app + obvious to
-- spot in logs/leaks). `key_prefix` is the first ~10 chars so the UI can show
-- a "key-ish" identifier without revealing the secret.

CREATE TABLE IF NOT EXISTS api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Human-readable name set by the user when minting the key ("Zapier", etc.)
  name          text NOT NULL CHECK (length(name) >= 1 AND length(name) <= 80),
  -- SHA-256 of the plaintext key. The plaintext is shown once at creation.
  -- Indexed (unique) so the auth middleware can do a single point lookup.
  key_hash      text NOT NULL UNIQUE,
  -- The first ~10 chars of the plaintext (e.g. "mvp_live_abc"). Lets the UI
  -- show "Key ending in xxxx" / "Key starting with mvp_live_ab..." without
  -- exposing the secret, AND lets us match logs that only have the prefix.
  key_prefix    text NOT NULL,
  -- Updated on every successful authenticated request through this key.
  -- Lets the user see "last used 2 hours ago" in the settings UI and
  -- detect dormant integrations to clean up.
  last_used_at  timestamptz,
  -- Set when the user revokes the key. We KEEP the row so the user can
  -- audit which keys were active when. Revoked keys can no longer
  -- authenticate (the auth middleware filters by revoked_at IS NULL).
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys (user_id);
-- Used by the auth middleware to scan ONLY active keys (revoked ones can't auth).
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys (key_hash) WHERE revoked_at IS NULL;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Users can only see / mint / revoke their own keys. The auth middleware
-- uses the admin client (bypass RLS) for the lookup step since the
-- incoming request hasn't been authenticated yet at that point.
CREATE POLICY "api_keys self-read" ON api_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "api_keys self-insert" ON api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "api_keys self-update" ON api_keys
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "api_keys self-delete" ON api_keys
  FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE api_keys IS
  'Pro-tier programmatic access. Plaintext shown once at creation; only the SHA-256 hash is persisted. Used by /api/v1/* Bearer auth.';
