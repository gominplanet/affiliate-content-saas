/**
 * GET /api/blog/live-post-ids
 *
 * Returns the set of post IDs that ACTUALLY exist (published) on each of the
 * user's WordPress sites, so the UI can reconcile its `blog_posts` catalog
 * against reality — a post deleted/trashed in WordPress still lingers in
 * `blog_posts` and would otherwise show as a phantom (404 link, source video
 * stuck on "published", etc.).
 *
 * Response:
 *   {
 *     liveIds: number[] | null,        // flat union across all sites (legacy)
 *     liveIdsBySite: { [siteId: string]: number[] } | null,  // per-site map
 *   }
 *
 *   - `liveIds` (flat) is kept for backwards compat with /content page code
 *     that only knows about one site. New code should prefer liveIdsBySite
 *     so it can check "is THIS post still live on ITS site" correctly for
 *     multi-site users.
 *   - null on either field → couldn't read any site's REST API; caller
 *     shows everything (a transient error must never hide real posts).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { listSites, getWordPressCredentials } from '@/lib/wordpress-sites'

export const maxDuration = 30

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sites = await listSites(supabase, user.id)

  // No wordpress_sites rows yet → fall back to legacy default site lookup
  // (covers users mid-migration who connected via the legacy integrations
  // columns and don't yet have a wordpress_sites row).
  if (sites.length === 0) {
    const def = await getWordPressCredentials(supabase, user.id)
    if (!def) {
      return NextResponse.json({ liveIds: null, liveIdsBySite: null })
    }
    try {
      const wpSvc = createWordPressService(
        def.wordpress_url,
        def.wordpress_username,
        def.wordpress_app_password,
        def.wordpress_api_token || undefined,
      )
      const ids = await wpSvc.getPublishedPostIds()
      if (!ids) {
        return NextResponse.json({ liveIds: null, liveIdsBySite: null })
      }
      const arr = Array.from(ids)
      return NextResponse.json({
        liveIds: arr,
        // Use the sentinel 'legacy' so consumers that DO want per-site can
        // still index into the map without special-casing nulls.
        liveIdsBySite: { legacy: arr },
      })
    } catch {
      return NextResponse.json({ liveIds: null, liveIdsBySite: null })
    }
  }

  // ── Multi-site: fan-out across every connected site in parallel. Each
  //    failure is isolated — one unreachable site shouldn't lock out the
  //    others. Results are returned both as a flat union (legacy) AND a
  //    per-site map (the new path for multi-site-aware UIs).
  const perSite = await Promise.all(sites.map(async (s) => {
    try {
      const wpSvc = createWordPressService(s.url, s.username, s.appPassword, s.apiToken || undefined)
      const ids = await wpSvc.getPublishedPostIds()
      // getPublishedPostIds() returns Set<number> | null — null means we
      // couldn't read the site, surface that as null per-site so callers
      // don't false-flag the site's posts as deleted.
      return { siteId: s.id, ids: ids ? Array.from(ids) : null as number[] | null }
    } catch {
      return { siteId: s.id, ids: null as number[] | null }
    }
  }))

  const liveIdsBySite: Record<string, number[]> = {}
  const flat = new Set<number>()
  let anyOk = false
  for (const { siteId, ids } of perSite) {
    if (!ids) continue
    anyOk = true
    liveIdsBySite[siteId] = ids
    for (const id of ids) flat.add(id)
  }
  if (!anyOk) {
    // Every site errored → return null so the UI shows everything (don't
    // hide live posts on a transient outage across sites).
    return NextResponse.json({ liveIds: null, liveIdsBySite: null })
  }
  return NextResponse.json({
    liveIds: Array.from(flat),
    liveIdsBySite,
  })
}
