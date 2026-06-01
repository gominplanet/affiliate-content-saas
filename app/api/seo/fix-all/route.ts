/**
 * POST /api/seo/fix-all  { dryRun?: boolean }
 *
 * Catalog-wide SEO fixer. dryRun returns how many posts have auto-fixable
 * issues (no writes, no AI). Apply runs "fix all" on each such post via the
 * shared engine, capped per request so it never times out — returns how many
 * were fixed and how many remain (the UI prompts to run again for the rest).
 *
 * MULTI-SITE: posts get grouped by wordpress_site_id and each group is fixed
 * against THAT site's WordPress install. A Pro user with 3 sites runs one
 * /fix-all that hits the right credentials per post — no risk of trying to
 * update a Wine-blog post against the Main site's WP API.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { applyPostFixes, fixableFailing, type FixablePost } from '@/lib/seo-fix'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export const maxDuration = 300

const BATCH_CAP = 20   // posts fixed per apply request (AI + WP writes are the cost)

// Internal: post shape with the multi-site routing column. Same as FixablePost
// plus wordpress_site_id (which may be null for legacy pre-Phase-3 rows).
interface FixablePostWithSite extends FixablePost {
  wordpress_site_id?: string | null
}

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { dryRun = false } = await request.json().catch(() => ({}))

  // Per-user data (tier). WP credentials are resolved per-post below
  // because in multi-site each post may live on a different site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id).single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postsRaw } = await supabase
    .from('blog_posts')
    .select('id,title,slug,content,seo_keyword,post_type,wordpress_post_id,wordpress_site_id')
    .eq('user_id', user.id)
    .not('wordpress_post_id', 'is', null)
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000)
  const allPosts = ((postsRaw as FixablePostWithSite[] | null) ?? []).filter(p => p.content && p.wordpress_post_id)

  // ── Group posts by site_id so we resolve credentials + live-ids once per site,
  //    not per post. Null site_id means "legacy / default site" — bucket them
  //    under a stable sentinel so the loop below treats them as one group.
  const LEGACY_BUCKET = '__legacy__'
  const grouped = new Map<string, FixablePostWithSite[]>()
  for (const p of allPosts) {
    const k = p.wordpress_site_id ?? LEGACY_BUCKET
    const arr = grouped.get(k) ?? []
    arr.push(p)
    grouped.set(k, arr)
  }

  // First-pass identity check: every site we're about to touch must have valid
  // credentials. If NO site has credentials, fail fast — there's no point
  // running fixers when nothing can be written back. If SOME sites fail we
  // skip those and report; users can re-run after fixing the broken site.
  const siteCache = new Map<string, {
    wpBase: string
    wpService: ReturnType<typeof createWordPressService>
    liveIds: Set<number> | null
  } | { ok: false; error: string }>()

  for (const siteKey of grouped.keys()) {
    const lookupId = siteKey === LEGACY_BUCKET ? null : siteKey
    const site = await getWordPressCredentials(supabase, user.id, lookupId)
    if (!site) {
      siteCache.set(siteKey, { ok: false, error: 'WordPress not connected for this site.' })
      continue
    }
    const wpBase = site.wordpress_url.replace(/\/$/, '')
    const wpService = createWordPressService(
      site.wordpress_url ?? '',
      site.wordpress_username ?? '',
      site.wordpress_app_password ?? '',
      site.wordpress_api_token || undefined,
    )
    // Reconcile against the LIVE WordPress site so we don't try to "fix" posts
    // the user has since deleted in WP (they linger in blog_posts but updatePost
    // would 404). null = couldn't read the site → keep everything (a transient
    // error must never lock out the whole bulk fixer).
    let liveIds: Set<number> | null = null
    try {
      liveIds = await wpService.getPublishedPostIds()
    } catch { liveIds = null }
    siteCache.set(siteKey, { wpBase, wpService, liveIds })
  }

  // No site with creds at all → block (most likely: brand new account, never
  // connected WP). Same UX as the legacy single-site path returned a 400 for.
  const anySiteHasCreds = Array.from(siteCache.values()).some(v => !('ok' in v && v.ok === false))
  if (!anySiteHasCreds) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }

  // ── Live-id reconciliation + fixable detection. Done per-site so each
  //    post is compared to ITS site's live posts, not all posts globally.
  let needFix: Array<{ post: FixablePostWithSite; fixes: ReturnType<typeof fixableFailing>; siteKey: string }> = []
  for (const [siteKey, sitePosts] of grouped.entries()) {
    const ctx = siteCache.get(siteKey)
    if (!ctx || 'ok' in ctx) continue  // site had no credentials; skip its posts
    const filtered = (ctx.liveIds && ctx.liveIds.size > 0)
      ? sitePosts.filter(p => p.wordpress_post_id != null && ctx.liveIds!.has(p.wordpress_post_id))
      : sitePosts
    for (const p of filtered) {
      const fixes = fixableFailing(p, ctx.wpBase)
      if (fixes.length > 0) needFix.push({ post: p, fixes, siteKey })
    }
  }

  // Stable ordering across sites so a re-run picks the same batch front-loaded
  // (without this, the Map iteration order could shuffle items between calls).
  needFix = needFix.sort((a, b) => String(a.post.id).localeCompare(String(b.post.id)))

  if (dryRun) {
    const totalFixes = needFix.reduce((s, x) => s + x.fixes.length, 0)
    return NextResponse.json({
      dryRun: true,
      total: allPosts.length,
      toFix: needFix.length,
      totalFixes,
      preview: needFix.slice(0, 200).map(x => ({
        postId: x.post.id,
        title: (x.post.title || x.post.slug || '').replace(/<[^>]+>/g, ''),
        fixes: x.fixes.length,
      })),
    })
  }

  // Apply — batched so we stay under the time budget. Per-post outcomes are
  // surfaced so the UI can show WHY nothing was fixed when fixed=0 (the
  // common confusing case: every fixer hit an "already done" or "no
  // candidates" branch and bailed). The shared engine returns reasons by
  // fix-type even when it didn't change anything.
  let fixed = 0
  const errors: string[] = []
  const skipped: Array<{ title: string; reasons: string[] }> = []
  const batch = needFix.slice(0, BATCH_CAP)
  for (const { post, siteKey } of batch) {
    const ctx = siteCache.get(siteKey)
    if (!ctx || 'ok' in ctx) {
      errors.push(`${post.title || post.id}: site not reachable`)
      continue
    }
    try {
      const r = await applyPostFixes({
        supabase,
        userId: user.id,
        wpService: ctx.wpService,
        wpBase: ctx.wpBase,
        tier: wp?.tier,
        post,
        fixes: 'all',
      })
      if (r.changed) {
        fixed++
      } else {
        const reasonStrs = Object.values(r.reasons || {}).filter(Boolean) as string[]
        skipped.push({
          title: ((post.title || post.id) as string).slice(0, 80),
          reasons: reasonStrs.length ? reasonStrs : ['Nothing actually changed (fixers ran but produced no diff).'],
        })
      }
    } catch (err) {
      errors.push(`${post.title || post.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const remaining = Math.max(0, needFix.length - batch.length)

  return NextResponse.json({
    success: true,
    fixed,
    remaining,
    attempted: batch.length,
    errors: errors.slice(0, 10),
    skipped: skipped.slice(0, 10),
  })
}
