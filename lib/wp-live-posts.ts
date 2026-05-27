// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.

/**
 * Live published post IDs from a WordPress site, via the public REST API.
 *
 * Used to reconcile our `blog_posts` catalog against what's ACTUALLY on the
 * site: a post deleted/trashed in WordPress still lingers in `blog_posts` and
 * would otherwise show as a phantom — a 404 URL, "not on Google", a source
 * video that still reads as "published", etc.
 *
 * Returns `null` when the site's REST API can't be read, so callers SKIP
 * reconciliation and show everything — a transient error must NEVER hide real
 * posts. `wpUrl` may include or omit a trailing slash.
 */
export async function fetchLiveWpPostIds(wpUrl: string): Promise<Set<number> | null> {
  const base = (wpUrl || '').replace(/\/$/, '')
  if (!base) return null
  try {
    const ids = new Set<number>()
    for (let page = 1; page <= 5; page++) {   // up to 500 published posts
      const r = await fetch(`${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=id`, {
        headers: { 'User-Agent': 'MVPAffiliate/1.0' },
        signal: AbortSignal.timeout(10000),
      })
      // A 400 on a page past the last is expected — keep whatever we gathered.
      if (!r.ok) return ids.size ? ids : null
      const arr = await r.json().catch(() => null)
      if (!Array.isArray(arr)) return ids.size ? ids : null
      for (const it of arr) { const id = (it as { id?: unknown }).id; if (typeof id === 'number') ids.add(id) }
      if (arr.length < 100) break
    }
    return ids.size ? ids : null
  } catch { return null }
}
