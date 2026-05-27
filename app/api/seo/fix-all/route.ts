/**
 * POST /api/seo/fix-all  { dryRun?: boolean }
 *
 * Catalog-wide SEO fixer. dryRun returns how many posts have auto-fixable
 * issues (no writes, no AI). Apply runs "fix all" on each such post via the
 * shared engine, capped per request so it never times out — returns how many
 * were fixed and how many remain (the UI prompts to run again for the rest).
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { applyPostFixes, fixableFailing, type FixablePost } from '@/lib/seo-fix'

export const maxDuration = 300

const BATCH_CAP = 20   // posts fixed per apply request (AI + WP writes are the cost)

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { dryRun = false } = await request.json().catch(() => ({}))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token,tier')
    .eq('user_id', user.id).single()
  if (!wp?.wordpress_url || !wp?.wordpress_app_password) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }
  const wpBase = wp.wordpress_url.replace(/\/$/, '')
  const wpService = createWordPressService(wp.wordpress_url, wp.wordpress_username, wp.wordpress_app_password, wp.wordpress_api_token || undefined)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: postsRaw } = await (supabase as any)
    .from('blog_posts')
    .select('id,title,slug,content,seo_keyword,post_type,wordpress_post_id')
    .eq('user_id', user.id)
    .not('wordpress_post_id', 'is', null)
    .not('content', 'is', null)
    .order('created_at', { ascending: false })
    .limit(2000)
  const posts = ((postsRaw as FixablePost[] | null) ?? []).filter(p => p.content && p.wordpress_post_id)

  // Cheap pass: which posts have auto-fixable failing checks (no network/AI).
  const needFix = posts
    .map(p => ({ post: p, fixes: fixableFailing(p, wpBase) }))
    .filter(x => x.fixes.length > 0)

  if (dryRun) {
    const totalFixes = needFix.reduce((s, x) => s + x.fixes.length, 0)
    return NextResponse.json({
      dryRun: true,
      total: posts.length,
      toFix: needFix.length,
      totalFixes,
      preview: needFix.slice(0, 200).map(x => ({
        postId: x.post.id,
        title: (x.post.title || x.post.slug || '').replace(/<[^>]+>/g, ''),
        fixes: x.fixes.length,
      })),
    })
  }

  // Apply — batched so we stay under the time budget.
  let fixed = 0
  const errors: string[] = []
  const batch = needFix.slice(0, BATCH_CAP)
  for (const { post } of batch) {
    try {
      const r = await applyPostFixes({ supabase, userId: user.id, wpService, wpBase, tier: wp.tier, post, fixes: 'all' })
      if (r.changed) fixed++
    } catch (err) {
      errors.push(`${post.title || post.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  const remaining = Math.max(0, needFix.length - batch.length)

  return NextResponse.json({ success: true, fixed, remaining, attempted: batch.length, errors: errors.slice(0, 10) })
}
