/**
 * Helper for transparent decryption of social tokens read from the
 * `integrations` table.
 *
 * Why: publish routes (blog/twitter-post, blog/facebook-post, etc.)
 * select '*' from integrations, then reach into individual token
 * fields. Wrapping each access site with maybeDecrypt() would mean
 * ~75 edits across 8+ files. This helper centralises that to a single
 * row-level wrap right after the SELECT.
 *
 * Usage:
 *   const { data } = await supabase.from('integrations').select('*')
 *     .eq('user_id', userId).maybeSingle()
 *   const integ = decryptIntegrationRow(data)
 *   // integ.twitter_access_token is now plaintext (or empty if absent)
 *
 * The helper is null-safe and idempotent — passing an already-
 * decrypted row through it is a no-op (maybeDecrypt detects legacy
 * plaintext via missing prefix).
 *
 * NOT covered here: wordpress_app_password / wordpress_api_token —
 * those are read via getWordPressCredentials() which already calls
 * maybeDecrypt() inside rowToSite(). This helper handles every OTHER
 * secret column on `integrations`.
 */

import { maybeDecrypt, maybeEncrypt } from '@/lib/secrets'

/** Every secret column on `integrations` whose value needs decrypting
 *  on read. Kept here in lockstep with the OAuth callback writes that
 *  encrypt these same columns — if you add a new token field to the
 *  schema + a new OAuth callback, ADD IT HERE TOO or reads will get
 *  ciphertext as their token. */
export const INTEGRATION_SECRET_COLUMNS = [
  // Facebook
  'facebook_page_access_token',
  // Pinterest
  'pinterest_access_token',
  'pinterest_refresh_token',
  // Threads
  'threads_access_token',
  // Twitter / X
  'twitter_access_token',
  'twitter_refresh_token',
  // LinkedIn
  'linkedin_access_token',
  // Bluesky
  'bluesky_app_password',
  // TikTok
  'tiktok_access_token',
  'tiktok_refresh_token',
  // Instagram
  'instagram_user_access_token',
  'instagram_long_lived_token',
  // Telegram
  'telegram_bot_token',
  // YouTube OAuth
  'youtube_oauth_access_token',
  'youtube_oauth_refresh_token',
  // GSC OAuth
  'gsc_oauth_access_token',
  'gsc_oauth_refresh_token',
  // WordPress (handled separately by rowToSite, but inclusive here so
  // a freshly-pulled integrations row is fully decrypted for routes
  // that read both kinds of secrets at once).
  'wordpress_app_password',
  'wordpress_api_token',
] as const

/** Transparently decrypt every known secret column on an integrations
 *  row. Returns a NEW object (doesn't mutate the input). Null-safe.
 *
 *  Idempotent — passing a row that's already plaintext (or partially
 *  decrypted) through it is a no-op for the unencrypted fields.
 */
export function decryptIntegrationRow<T extends Record<string, unknown> | null | undefined>(row: T): T {
  if (!row) return row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = { ...(row as Record<string, unknown>) }
  for (const col of INTEGRATION_SECRET_COLUMNS) {
    const v = out[col]
    if (typeof v === 'string' && v.length > 0) {
      try {
        out[col] = maybeDecrypt(v)
      } catch (e) {
        // Decryption failed — corrupted ciphertext or key mismatch.
        // Surface as null so the caller sees "no token connected" rather
        // than crashing or worse, using the ciphertext as the token.
        console.warn(`[integration-secrets] decrypt failed for ${col}: ${e instanceof Error ? e.message : 'unknown'}`)
        out[col] = null
      }
    }
  }
  return out as T
}

/** Encrypt every known secret column on a partial integrations row that's
 *  about to be inserted/upserted. Use this in OAuth callback writes.
 *
 *  Returns a NEW object with encrypted secret values, leaving non-secret
 *  fields untouched. Null/empty token values pass through unchanged.
 *
 *  Usage:
 *    await supabase.from('integrations').upsert(
 *      encryptIntegrationWrite({
 *        user_id: user.id,
 *        twitter_access_token: tokens.access_token,
 *        twitter_refresh_token: tokens.refresh_token,
 *        twitter_handle: profile.username, // non-secret, untouched
 *      }),
 *      { onConflict: 'user_id' },
 *    )
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function encryptIntegrationWrite<T extends Record<string, any>>(values: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Record<string, any> = { ...values }
  for (const col of INTEGRATION_SECRET_COLUMNS) {
    if (col in out) {
      const v = out[col]
      if (typeof v === 'string' && v.length > 0) {
        out[col] = maybeEncrypt(v)
      }
    }
  }
  return out as T
}
