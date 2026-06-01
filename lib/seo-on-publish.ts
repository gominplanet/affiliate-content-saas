// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Fire-and-forget post-publish SEO hook. Pings IndexNow (Bing / Copilot / Yandex)
// the moment a post goes live on the user's site — those engines crawl within
// hours rather than waiting for Google's next sitemap pass. (Google doesn't
// participate in IndexNow; its lever is the sitemap + GSC URL inspection, which
// the daily cron refreshes separately.)
//
// Best-effort: any error here is SWALLOWED — a slow Bing endpoint or a plugin
// that hasn't been updated yet must NEVER block the publish response.
//
// Caller pattern (do NOT await):
//   void pingIndexNowForUrl(supabase, userId, postUrl).catch(() => {})
import { submitToIndexNow } from './indexnow'
import { getWordPressCredentials } from './wordpress-sites'

/**
 * Submit a single URL to IndexNow on behalf of `userId`. Reads WP creds + the
 * plugin's hosted IndexNow key, then submits. Resolves `true` on success,
 * `false` on any failure (including the plugin being too old to expose a key).
 *
 * MULTI-SITE: pass `siteId` to ping IndexNow on a SPECIFIC site (each WP
 * install hosts its own IndexNow key). Omit → user's default site. The
 * blog/generate hook passes `site.site_id` here so a freshly-published post
 * on the Wine blog pings Wine's key, not Main's.
 */
export async function pingIndexNowForUrl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  url: string,
  siteId?: string | null,
): Promise<boolean> {
  if (!url || !/^https?:\/\//i.test(url)) return false
  try {
    const site = await getWordPressCredentials(supabase, userId, siteId)
    if (!site) return false

    const wpBase = site.wordpress_url.replace(/\/$/, '')
    const auth = `Basic ${Buffer.from(`${site.wordpress_username}:${site.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}`

    // Plugin v1.0.11+ exposes the per-site IndexNow key at /wp-json/affiliateos/v1/status.
    const sRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/status`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    })
    if (!sRes.ok) return false
    const s = (await sRes.json().catch(() => ({}))) as { indexnow_key?: string }
    const key = s?.indexnow_key || ''
    if (!key) return false

    const r = await submitToIndexNow(wpBase, key, [url])
    return r.ok
  } catch {
    return false
  }
}
