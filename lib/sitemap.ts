// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Reads a WordPress site's XML sitemap and returns the set of post slugs it
// contains, so the SEO hub can flag posts MISSING from the sitemap — the exact
// "published but not discoverable" bug we hit in the field (stale Rank Math
// cache). Handles a sitemap index (Rank Math / Yoast) or a flat sitemap (core
// wp-sitemap). Bounded fetches + short timeouts so it never stalls a request.

function addSlug(set: Set<string>, url: string): void {
  try {
    const s = new URL(url).pathname.replace(/\/$/, '').split('/').filter(Boolean).pop()
    if (s) set.add(decodeURIComponent(s).toLowerCase())
  } catch { /* skip unparseable */ }
}

const SITEMAP_RE = /sitemap.*\.xml(\?|$)/i

/**
 * Returns the slugs present in the site's sitemap and whether a sitemap was
 * found at all. `found:false` means we couldn't read any sitemap (don't show
 * "missing" warnings in that case — it'd be misleading).
 */
export async function fetchSitemapSlugs(siteUrl: string): Promise<{ slugs: Set<string>; found: boolean }> {
  const base = (siteUrl || '').replace(/\/$/, '')
  const slugs = new Set<string>()
  if (!base) return { slugs, found: false }

  const candidates = [`${base}/sitemap_index.xml`, `${base}/sitemap.xml`, `${base}/wp-sitemap.xml`]
  const get = async (url: string): Promise<string | null> => {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
      return r.ok ? await r.text() : null
    } catch { return null }
  }

  for (const idx of candidates) {
    const xml = await get(idx)
    if (!xml) continue
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1].trim())
    const subSitemaps = locs.filter(u => SITEMAP_RE.test(u))
    const pageUrls = locs.filter(u => !SITEMAP_RE.test(u))
    for (const u of pageUrls) addSlug(slugs, u)
    // Fetch sub-sitemaps (post-sitemap first), capped.
    const ordered = subSitemaps.sort((a, b) => (/post/i.test(b) ? 1 : 0) - (/post/i.test(a) ? 1 : 0)).slice(0, 6)
    await Promise.all(ordered.map(async sm => {
      const x = await get(sm)
      if (!x) return
      for (const m of x.matchAll(/<loc>([^<]+)<\/loc>/gi)) addSlug(slugs, m[1].trim())
    }))
    return { slugs, found: true }
  }
  return { slugs, found: false }
}
