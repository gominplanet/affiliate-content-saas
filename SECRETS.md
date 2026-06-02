# Secrets encryption at rest

WordPress App Passwords, social OAuth tokens, and body-auth proxy secrets are now encrypted in the database with AES-256-GCM. This doc covers how to set up the key and run the one-time migration.

---

## 1. Generate + set the encryption key

The key lives in the `MVP_CRYPTO_KEY` env var. **32 random bytes, hex-encoded** (64 hex chars).

**Generate:**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This prints something like:
```
b5e1d4f9a8c7e2d3b6c4f7a1d9e8b3c5d2f4e6a7b8c9d1e3f5a7b9c1d3e5f7a9
```

**Set in Vercel (production + preview):**
1. Project → Settings → Environment Variables
2. Name: `MVP_CRYPTO_KEY`
3. Value: paste the hex string
4. Mark as **Sensitive** (write-only after creation — per your standing rule)
5. Apply to: **Production, Preview, Development**
6. Save

**Set in local dev (`.env.local`):**
```
MVP_CRYPTO_KEY=b5e1d4f9...   # paste the same hex value
```

> ⚠️ **Critical:** the same key MUST be set everywhere the app runs. A different key in production vs preview = encrypted-by-prod, can't-decrypt-in-preview corruption.

---

## 2. Run the migration (one-time)

The migration script walks `integrations`, `wordpress_sites`, and `social_accounts`, encrypts every plaintext secret it finds, and writes them back. Idempotent — safe to re-run, skips already-encrypted rows.

**Dry run first (recommended):**
```bash
MVP_CRYPTO_KEY=<your hex>  \
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co  \
SUPABASE_SERVICE_ROLE_KEY=<service role key>  \
npx tsx scripts/encrypt-existing-secrets.ts --dry-run
```

This prints what WOULD change. No DB writes. Verify the row counts look right before continuing.

**Run for real:**
```bash
MVP_CRYPTO_KEY=<your hex>  \
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co  \
SUPABASE_SERVICE_ROLE_KEY=<service role key>  \
npx tsx scripts/encrypt-existing-secrets.ts
```

Output looks like:
```
=== integrations ===
  ...25/42 done
  integrations: 42 encrypted · 0 already-encrypted · 0 errors · 42 total

=== wordpress_sites ===
  wordpress_sites: 8 encrypted · 0 already-encrypted · 0 errors · 8 total

=== social_accounts ===
  social_accounts: 3 encrypted · 0 already-encrypted · 0 errors · 3 total

=== Summary ===
  integrations: 42 encrypted / 0 skipped / 0 errors / 42 total
  wordpress_sites: 8 encrypted / 0 skipped / 0 errors / 8 total
  social_accounts: 3 encrypted / 0 skipped / 0 errors / 3 total
```

---

## 3. Verify the rollout

After migrating, spot-check a row in Supabase Studio:

```sql
SELECT wordpress_app_password FROM integrations LIMIT 1;
```

You should see:
```
enc:v1:GxN8fK2pL...
```

The `enc:v1:` prefix tells the app this is ciphertext. App reads go through `maybeDecrypt()` in [lib/wordpress-sites.ts](lib/wordpress-sites.ts) which detects the prefix and decrypts transparently.

---

## 4. What's encrypted (covered today)

Encrypted on write + transparently decrypted on read:

- `wordpress_sites.app_password` — WP Application Password per site
- `wordpress_sites.api_token` — body-auth proxy secret per site
- `integrations.wordpress_app_password` — legacy single-site WP password
- `integrations.wordpress_api_token` — legacy mirror of the same

The migration script also covers (in the same pass — see [scripts/encrypt-existing-secrets.ts](scripts/encrypt-existing-secrets.ts) `PLAN`):

- `integrations.facebook_page_access_token`
- `integrations.pinterest_access_token`
- `integrations.threads_access_token`
- `integrations.twitter_access_token`
- `integrations.linkedin_access_token`
- `integrations.bluesky_app_password`
- `integrations.tiktok_access_token` / `tiktok_refresh_token`
- `integrations.instagram_user_access_token` / `instagram_long_lived_token`
- `integrations.telegram_bot_token`
- `integrations.youtube_oauth_access_token` / `youtube_oauth_refresh_token`
- `social_accounts.access_token`

The migration encrypts those columns once, but the WRITE paths in the OAuth callbacks for those platforms still need a `maybeEncrypt()` wrap to keep them encrypted on re-connect. That's a follow-up sweep (~10 OAuth callback files). Until then, if a user reconnects (e.g., Facebook), the new token will land as plaintext. Reads still work (`maybeDecrypt` handles both), but reconnect rows go back to plaintext until the sweep ships.

---

## 5. Threat model

What encryption protects against:
- A read-only RLS bypass (a future route accidentally uses createAdminClient) — attacker sees ciphertext, can't extract the plaintext token without `MVP_CRYPTO_KEY`.
- A DB snapshot leak (someone gets a Supabase backup) — same.
- A SQL injection that exfils data — same.

What it does NOT protect against:
- Server compromise (attacker has the `MVP_CRYPTO_KEY` env var).
- Application-level RCE that runs `decryptSecret()` directly.

So this is **defense in depth**, not the only line of defense. It raises the bar significantly for the most likely attack patterns (snapshot/leak/RLS) without claiming to defeat root-level access.

---

## 6. Key rotation (future work)

Out of scope for v1. When we need to rotate:
1. Generate new key, add as `MVP_CRYPTO_KEY_NEW`.
2. Update `lib/secrets.ts` to accept both keys for decryption (try new, fall back to old).
3. Re-run migration in re-encrypt mode (force decrypt-with-old + re-encrypt-with-new).
4. Swap envs: `MVP_CRYPTO_KEY = MVP_CRYPTO_KEY_NEW`. Remove old.

The `enc:v1:` magic prefix already supports versioning — a future `enc:v2:` cipher upgrade is the same flow.

---

## 7. Strict mode (future)

Once the migration completes and all reads-from-old-rows have flushed, we can flip `maybeDecrypt()` to reject plaintext (treat unencrypted columns as a tampered/migrated-out state). That's defense in depth — protects against future accidental writes that skip `maybeEncrypt()`. Tracked as a `// TODO: strict-mode` comment in `lib/secrets.ts`.
