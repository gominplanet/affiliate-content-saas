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
import { getAuthAndOwner } from '@/lib/agency-auth'

export const maxDuration = 120

export async function POST(request: Request) {
  const supabase = await createServerClient()
  // Resource lookups go through ownerId so this matches the SEO overview the
  // user is looking at — a VA (or admin viewing-as) sees the OWNER's posts, so
  // scoping the fix to the authenticated user.id would 404 every one of them.
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { postId, fix } = (await request.json().catch(() => ({}))) as { postId?: string; fix?: SeoFixType | 'all' }
  if (!postId || !fix || (fix !== 'all' && !SEO_FIX_TYPES.includes(fix as SeoFixType))) {
    return NextResponse.json({ error: 'postId and a valid fix are required' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: post } = await supabase
    .from('blog_posts')
    .select('id,title,slug,content,seo_keyword,post_type,wordpress_post_id,wordpress_site_id')
    .eq('user_id', ownerId).eq('id', postId).maybeSingle()
  if (!post) {
    return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
  }
  if (!post.wordpress_post_id) {
    return NextResponse.json({ error: 'This post isn’t published to WordPress yet.' }, { status: 404 })
  }

  // Tier comes from the owner's integrations; WP credentials route to the
  // specific site this post lives on (multi-site fix routing).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', ownerId).single()
  const site = await getWordPressCredentials(
    supabase,
    ownerId,
    (post as { wordpress_site_id?: string | null }).wordpress_site_id,
  )
  if (!site) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }
  const wpBase = site.wordpress_url.replace(/\/$/, '')
  const wpService = createWordPressService(site.wordpress_url ?? '', site.wordpress_username ?? '', site.wordpress_app_password ?? '', site.wordpress_api_token || undefined)

  // HYDRATE FROM WORDPRESS when MVP has no stored body. Legacy/imported posts
  // are live on WP but have an empty blog_posts.content; the auto-fixer edits
  // the STORED HTML, so without the real body it can't run. Rather than force a
  // rebuild (the post is already there — the user just wants to fix a few
  // things), we pull the live body, fix it IN PLACE, and backfill the stored
  // copy so the score + future fixes stop treating it as empty.
  let workingPost = post as FixablePost
  if (!post.content || !String(post.content).trim()) {
    const live = await wpService.getPostContent(post.wordpress_post_id)
    if (!live || !live.content.trim()) {
      return NextResponse.json({ error: 'We couldn’t load this post’s content from WordPress to edit. Try again in a moment — or use “Rebuild from video” to regenerate it.' }, { status: 422 })
    }
    workingPost = { ...(post as FixablePost), content: live.content, title: post.title || live.title }
    // Best-effort backfill so the next overview scores the real body (and this
    // row stops showing the misleading near-zero score).
    await supabase.from('blog_posts').update({ content: live.content, ...(post.title ? {} : { title: live.title }) }).eq('id', post.id)
  }

  try {
    const result = await applyPostFixes({
      supabase, userId: ownerId, wpService, wpBase, tier: wp?.tier,
      post: workingPost,
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
