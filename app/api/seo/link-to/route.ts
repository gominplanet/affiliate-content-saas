/**
 * POST /api/seo/link-to  { fromPostId, toPostId }
 *
 * Adds a link to one post (toPostId) from another (fromPostId) and republishes
 * the "from" post. Built for the SEO page's per-post board: a post Google has
 * not read, or has passed over, gets its strongest path in from a post Google
 * already shows. The link goes into the from-post's "Also worth considering"
 * block (lib/internal-links addLinkToPost), never twice to the same address.
 *
 * Says exactly what happened: added, already linked, or why it could not.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { addLinkToPost } from '@/lib/internal-links'
import { scorePostSeo } from '@/lib/seo-score'
import { pingIndexNowForUrl } from '@/lib/seo-on-publish'

export const maxDuration = 60

type Row = { id: string; title: string | null; slug: string | null; content: string | null; seo_keyword: string | null; post_type: string | null; wordpress_post_id: number | null; wordpress_site_id: string | null; wordpress_url: string | null }

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  const { fromPostId, toPostId } = (await request.json().catch(() => ({}))) as { fromPostId?: string; toPostId?: string }
  if (!fromPostId || !toPostId || fromPostId === toPostId) {
    return NextResponse.json({ error: 'Pick a different post to link from.' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from('blog_posts')
    .select('id,title,slug,content,seo_keyword,post_type,wordpress_post_id,wordpress_site_id,wordpress_url')
    .eq('user_id', ownerId).in('id', [fromPostId, toPostId])
  const from = ((rows ?? []) as Row[]).find((r) => r.id === fromPostId)
  const to = ((rows ?? []) as Row[]).find((r) => r.id === toPostId)
  if (!from || !to) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
  if (!from.wordpress_post_id) return NextResponse.json({ error: `"${from.title}" is not published on WordPress.` }, { status: 422 })
  if (!to.wordpress_url) return NextResponse.json({ error: `MVP does not have the address of "${to.title}". Press Refresh post URLs under Tools, then try again.` }, { status: 422 })
  if ((from.wordpress_site_id || null) !== (to.wordpress_site_id || null)) {
    return NextResponse.json({ error: 'These two posts are on different blogs. Pick a post on the same blog.' }, { status: 422 })
  }

  const site = await getWordPressCredentials(supabase, ownerId, from.wordpress_site_id)
  if (!site) return NextResponse.json({ error: 'WordPress is not connected.' }, { status: 400 })
  const wpBase = site.wordpress_url.replace(/\/$/, '')
  const wp = createWordPressService(site.wordpress_url ?? '', site.wordpress_username ?? '', site.wordpress_app_password ?? '', site.wordpress_api_token || undefined)

  // The live body when MVP has none stored (older or imported posts).
  let body = from.content || ''
  if (!body.trim()) {
    const live = await wp.getPostContent(from.wordpress_post_id).catch(() => null)
    if (!live || !live.content.trim()) {
      return NextResponse.json({ error: `MVP could not read "${from.title}" from WordPress. Try again in a moment.` }, { status: 502 })
    }
    body = live.content
  }

  const r = addLinkToPost(body, { title: to.title || 'Related review', url: to.wordpress_url, postType: to.post_type })
  if (!r.added) return NextResponse.json({ ok: true, added: false, note: r.reason })

  try {
    await wp.updatePost(from.wordpress_post_id, { content: r.content })
  } catch (e) {
    return NextResponse.json({ error: `WordPress did not save the change: ${e instanceof Error ? e.message : 'unknown error'}` }, { status: 502 })
  }
  await supabase.from('blog_posts').update({ content: r.content }).eq('id', from.id)
  const { score, checks } = scorePostSeo({ title: from.title || '', contentHtml: r.content, siteHost: wpBase, postType: from.post_type || 'review', seoKeyword: from.seo_keyword })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  try { await (supabase as any).from('post_seo').update({ seo_score: score, score_detail: checks }).eq('post_id', from.id) } catch { /* score refreshes on the next load */ }
  // The from-post changed, so Bing and Copilot can re-read it now.
  if (from.wordpress_url) void pingIndexNowForUrl(supabase, ownerId, from.wordpress_url, from.wordpress_site_id).catch(() => {})

  return NextResponse.json({ ok: true, added: true, from: from.title, to: to.title })
}
