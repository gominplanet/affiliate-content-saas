/**
 * POST /api/seo/recheck { postId }
 *
 * Single-post Google Search Console URL Inspection refresh — the engine behind
 * the SEO page's per-row "Check" button. Much faster (and cheaper on the
 * 600/day inspection quota) than re-running the full overview when the user
 * just wants the fresh status of ONE post.
 *
 * Returns the fresh indexing fields so the client can update that row in place
 * without a full page reload.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getValidGscToken, inspectUrl } from '@/lib/gsc'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export const maxDuration = 30

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { postId?: string }
  const postId = body.postId
  if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

  // GSC: per-user. WP credentials come from THIS post's wordpress_site_id
  // so multi-site users get the right base URL (Wine post → wine-blog.com,
  // not the user's default site).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: integ } = await supabase
    .from('integrations')
    .select('gsc_property')
    .eq('user_id', user.id).single()
  const property = (integ?.gsc_property as string | null) || null
  if (!property) {
    return NextResponse.json({ error: 'Search Console isn’t connected — connect it in Setup → SEO first.' }, { status: 409 })
  }

  const token = await getValidGscToken(supabase, user.id)
  if (!token) {
    return NextResponse.json({ error: 'GSC token unavailable — reconnect Search Console.' }, { status: 401 })
  }

  // Resolve the post URL from its slug, scoped to the requesting user. We
  // also pull wordpress_site_id so the URL base is correct for multi-site.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: post } = await supabase
    .from('blog_posts')
    .select('id,slug,wordpress_site_id')
    .eq('id', postId).eq('user_id', user.id).single()
  if (!post?.slug) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })
  const site = await getWordPressCredentials(
    supabase,
    user.id,
    (post as { wordpress_site_id?: string | null }).wordpress_site_id,
  )
  if (!site) {
    return NextResponse.json({ error: 'WordPress isn’t connected.' }, { status: 409 })
  }
  const wpBase = site.wordpress_url.replace(/\/$/, '')
  const url = `${wpBase}/${post.slug}`

  const ins = await inspectUrl(token, property, url)
  if (!ins) {
    return NextResponse.json({ error: 'URL Inspection returned no result. Try again in a minute.' }, { status: 502 })
  }

  const indexed_state = ins.indexed ? 'indexed' : 'not_indexed'
  // Upsert touches ONLY the indexing fields — leave seo_score / clicks / etc.
  // intact for the overview route's on-load refresh.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('post_seo').upsert({
    post_id: post.id,
    user_id: user.id,
    url,
    indexed_state,
    coverage_state: ins.coverageState,
    last_crawl: ins.lastCrawl,
    checked_at: new Date().toISOString(),
  }, { onConflict: 'post_id' })

  return NextResponse.json({
    ok: true,
    indexed: ins.indexed,
    indexed_state,
    coverageState: ins.coverageState,
    lastCrawl: ins.lastCrawl,
  })
}
