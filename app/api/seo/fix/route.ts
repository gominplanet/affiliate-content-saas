/**
 * POST /api/seo/fix  { postId, fix }
 *
 * Applies SEO fixes to ONE published post and republishes. fix is a single
 * fix id ('internal_links' | 'faq' | 'title_length' | 'image_alt') or 'all'
 * (every failing fixable check). Thin wrapper over the shared engine in
 * lib/seo-fix so single-post + bulk ("Fix all posts") stay identical.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { applyPostFixes, SEO_FIX_TYPES, type SeoFixType, type FixablePost } from '@/lib/seo-fix'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export const maxDuration = 120

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { postId, fix } = (await request.json().catch(() => ({}))) as { postId?: string; fix?: SeoFixType | 'all' }
  if (!postId || !fix || (fix !== 'all' && !SEO_FIX_TYPES.includes(fix as SeoFixType))) {
    return NextResponse.json({ error: 'postId and a valid fix are required' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: post } = await supabase
    .from('blog_posts')
    .select('id,title,slug,content,seo_keyword,post_type,wordpress_post_id,wordpress_site_id')
    .eq('user_id', user.id).eq('id', postId).maybeSingle()
  if (!post?.content || !post.wordpress_post_id) {
    return NextResponse.json({ error: 'Post not found or not published.' }, { status: 404 })
  }

  // Tier comes from per-user integrations; WP credentials route to the
  // specific site this post lives on (multi-site fix routing).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id).single()
  const site = await getWordPressCredentials(
    supabase,
    user.id,
    (post as { wordpress_site_id?: string | null }).wordpress_site_id,
  )
  if (!site) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }
  const wpBase = site.wordpress_url.replace(/\/$/, '')
  const wpService = createWordPressService(site.wordpress_url ?? '', site.wordpress_username ?? '', site.wordpress_app_password ?? '', site.wordpress_api_token || undefined)

  try {
    const result = await applyPostFixes({
      supabase, userId: user.id, wpService, wpBase, tier: wp?.tier,
      post: post as FixablePost,
      fixes: fix === 'all' ? 'all' : [fix as SeoFixType],
    })
    // Single-fix mode: if the requested fix didn't apply, surface why.
    if (fix !== 'all' && !result.applied.includes(fix as SeoFixType)) {
      return NextResponse.json({ error: result.reasons[fix as SeoFixType] || 'Nothing to fix.' }, { status: 422 })
    }
    return NextResponse.json({ ok: true, fix, applied: result.applied, score: result.score })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fix failed' }, { status: 500 })
  }
}
