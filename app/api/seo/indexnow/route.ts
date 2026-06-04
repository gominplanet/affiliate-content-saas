/**
 * POST /api/seo/indexnow
 *
 * Pushes the user's published post URLs to IndexNow (Bing / Copilot / Yandex)
 * for near-instant crawling. The per-site IndexNow key is hosted + reported by
 * the MVP WordPress plugin (v1.0.11+); we read it from the plugin's /status
 * endpoint, then submit. (Google doesn't support IndexNow — for Google the
 * sitemap + GSC are the levers.)
 *
 * MULTI-SITE: each WordPress site hosts its OWN IndexNow key at /{key}.txt.
 * We group posts by their wordpress_site_id, fetch each site's key, and
 * submit the URLs that belong to that site against that site's key. Posts
 * with no site_id (legacy) submit against the user's default site.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { submitToIndexNow } from '@/lib/indexnow'
import { getWordPressCredentials, listSites } from '@/lib/wordpress-sites'

export const maxDuration = 60

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Load posts and group by site ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: posts } = await supabase
    .from('blog_posts')
    .select('slug,wordpress_site_id')
    .eq('user_id', user.id)
    .not('wordpress_post_id', 'is', null)
    .order('published_at', { ascending: false })
    .limit(2000)
  const allPosts = ((posts ?? []) as { slug: string | null; wordpress_site_id: string | null }[])
    .filter(p => !!p.slug)
  if (allPosts.length === 0) return NextResponse.json({ error: 'No published posts to submit.' }, { status: 422 })

  // Build a sites map so legacy rows (wordpress_site_id null) bucket to the
  // user's default site. The default-site lookup is one call regardless of
  // how many legacy rows we have.
  const sites = await listSites(supabase, user.id)
  if (sites.length === 0) {
    // No wordpress_sites rows at all — try the legacy bridge once.
    const def = await getWordPressCredentials(supabase, user.id)
    if (!def) {
      return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
    }
    return submitForSingleSite(def, allPosts.map(p => p.slug!).filter(Boolean))
  }

  const defaultSiteId = sites.find(s => s.isDefault)?.id ?? sites[0].id

  // Group post slugs by the site they belong to.
  const grouped = new Map<string, string[]>()
  for (const p of allPosts) {
    const key = p.wordpress_site_id ?? defaultSiteId
    const arr = grouped.get(key) ?? []
    arr.push(p.slug!)
    grouped.set(key, arr)
  }

  // ── Submit per site, IN PARALLEL ─────────────────────────────────────────
  // Each site's credential lookup + /status fetch (10s timeout!) + submit
  // call used to run serially. A 3-site Pro user paid 3× the wall-time.
  // Promise.all gates on the slowest single site, not the sum.
  const perSiteResults = await Promise.all(Array.from(grouped.entries()).map(async ([siteId, slugs]) => {
    const site = await getWordPressCredentials(supabase, user.id, siteId)
    if (!site) {
      return { site: siteId, error: 'site credentials unavailable' } as { site: string; submitted?: number; error?: string }
    }
    const wpBase = site.wordpress_url.replace(/\/$/, '')
    const auth = `Basic ${Buffer.from(`${site.wordpress_username}:${site.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}`

    // Per-site IndexNow key from the plugin's /status endpoint.
    let key = ''
    try {
      const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/status`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) })
      if (res.ok) { const s = await res.json().catch(() => ({})); key = (s?.indexnow_key as string) || '' }
    } catch { /* per-site failure is non-fatal */ }
    if (!key) {
      return { site: site.site_label, error: 'IndexNow not available — update the MVP plugin to v1.0.11+ on this site.' }
    }

    const urls = slugs.map(slug => `${wpBase}/${slug}`)
    const result = await submitToIndexNow(wpBase, key, urls)
    if (!result.ok) {
      return { site: site.site_label, error: `IndexNow rejected the request (status ${result.status}).` }
    }
    return { site: site.site_label, submitted: result.submitted }
  }))
  const totalSubmitted = perSiteResults.reduce((sum, r) => sum + (r.submitted ?? 0), 0)

  if (totalSubmitted === 0) {
    return NextResponse.json({ error: 'No URLs accepted by IndexNow.', sites: perSiteResults }, { status: 502 })
  }
  return NextResponse.json({ ok: true, submitted: totalSubmitted, sites: perSiteResults })
}

/** Legacy single-site path — only hit when wordpress_sites is empty (a
 *  brand-new user who connected via the legacy integrations.wordpress_*
 *  columns and we haven't backfilled yet). Behaves exactly like the
 *  pre-multi-site route did. */
async function submitForSingleSite(
  site: {
    wordpress_url: string
    wordpress_username: string
    wordpress_app_password: string
  },
  slugs: string[],
) {
  const wpBase = site.wordpress_url.replace(/\/$/, '')
  const auth = `Basic ${Buffer.from(`${site.wordpress_username}:${site.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}`
  let key = ''
  try {
    const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/status`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) })
    if (res.ok) { const s = await res.json().catch(() => ({})); key = (s?.indexnow_key as string) || '' }
  } catch { /* fall through */ }
  if (!key) {
    return NextResponse.json({ error: 'IndexNow isn’t available yet — update the MVP plugin (Setup → reinstall) to v1.0.11+, which hosts the IndexNow key. Then try again.' }, { status: 409 })
  }
  const urls = slugs.map(slug => `${wpBase}/${slug}`)
  const result = await submitToIndexNow(wpBase, key, urls)
  if (!result.ok) {
    return NextResponse.json({ error: `IndexNow rejected the request (status ${result.status}). Make sure ${wpBase}/${key}.txt is reachable.` }, { status: 502 })
  }
  return NextResponse.json({ ok: true, submitted: result.submitted })
}
