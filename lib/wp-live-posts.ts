// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.

/**
 * Live published post IDs from a WordPress site, via the REST API.
 *
 * Used to reconcile our `blog_posts` catalog against what's ACTUALLY on the
 * site: a post deleted/trashed in WordPress still lingers in `blog_posts` and
 * would otherwise show as a phantom — a 404 URL, "not on Google", a source
 * video that still reads as "published", etc.
 *
 * IMPORTANT: pass `auth` (Basic `username:app_password`, base64). Some hosts
 * (Hostinger, SiteGround) put a WAF/CDN challenge in front of UNAUTHENTICATED
 * /wp-json GETs from datacenter IPs (like Vercel's), which returns a non-JSON
 * challenge page and makes reconciliation silently no-op. The authenticated
 * call is the same one /api/wordpress/posts uses successfully on those hosts.
 *
 * Returns `null` when the site's REST API can't be read, so callers SKIP
 * reconciliation and show everything — a transient error must NEVER hide real
 * posts. `wpUrl` may include or omit a trailing slash.
 */
export async function fetchLiveWpPostIds(wpUrl: string, auth?: string): Promise<Set<number> | null> {
  const base = (wpUrl || '').replace(/\/$/, '')
  if (!base) return null
  const headers: Record<string, string> = { 'User-Agent': 'MVPAffiliate/1.0' }
  if (auth) headers.Authorization = `Basic ${auth}`
  try {
    const ids = new Set<number>()
    for (let page = 1; page <= 10; page++) {   // up to 1000 published posts
      const r = await fetch(
        `${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish&orderby=id&order=desc&_fields=id`,
        { headers, signal: AbortSignal.timeout(12000) },
      )
      // A 400 on a page past the last is expected — keep whatever we gathered.
      if (!r.ok) return ids.size ? ids : null
      const arr = await r.json().catch(() => null)
      if (!Array.isArray(arr)) return ids.size ? ids : null   // HTML challenge page, etc.
      for (const it of arr) { const id = (it as { id?: unknown }).id; if (typeof id === 'number') ids.add(id) }
      const totalPages = parseInt(r.headers.get('X-WP-TotalPages') || '1', 10)
      if (arr.length < 100 || page >= totalPages) break
    }
    return ids.size ? ids : null
  } catch { return null }
}

/** Build the Basic-auth header value (base64 of user:app_password) for the
 *  WP REST API. App passwords are shown with spaces in wp-admin; strip them. */
export function wpBasicAuth(username?: string | null, appPassword?: string | null): string | undefined {
  if (!username || !appPassword) return undefined
  return Buffer.from(`${username}:${String(appPassword).replace(/\s+/g, '')}`).toString('base64')
}
