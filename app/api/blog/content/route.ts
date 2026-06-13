/**
 * GET  /api/blog/content?postId=<uuid>   → { content }   (the article HTML)
 * POST /api/blog/content                  → save edited article
 *
 * Manual word-level editing of a published post. The editor preserves
 * the post's HTML structure (headings, links — including the affiliate
 * links — etc.); the user edits the prose and saves. We persist to
 * blog_posts.content AND push the change to the live WordPress post.
 *
 * POST body: { postId: string, content: string }
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { isStalePostError, WP_STALE_POST_MESSAGE } from '@/lib/wp-errors'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const postId = new URL(request.url).searchParams.get('postId')
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // postId may be the blog_posts UUID (video-backed posts pass this) OR a
    // WordPress numeric post id (video-less "link" posts pass this — the Posts
    // tab only knows their WP id). Match the right column accordingly.
    const byWpId = /^\d+$/.test(postId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await supabase
      .from('blog_posts')
      .select('content,title')
      .eq(byWpId ? 'wordpress_post_id' : 'id', byWpId ? Number(postId) : postId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    return NextResponse.json({ content: post.content ?? '', title: post.title ?? '' })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { postId, content } = await request.json() as { postId?: string; content?: string }
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    if (typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Content is empty' }, { status: 400 })
    }

    // postId may be the blog_posts UUID or a WordPress numeric post id (the
    // video-less "link" posts only know their WP id). Match the right column.
    const byWpId = /^\d+$/.test(postId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await supabase
      .from('blog_posts')
      .select('id,wordpress_post_id,wordpress_site_id')
      .eq(byWpId ? 'wordpress_post_id' : 'id', byWpId ? Number(postId) : postId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // Always update by the resolved UUID so both id forms write the same row.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updErr } = await supabase
      .from('blog_posts')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', (post as { id: string }).id)
      .eq('user_id', user.id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    if (!post.wordpress_post_id) {
      return NextResponse.json({ ok: true, pushedToWp: false, reason: 'no_wp_post' })
    }

    // Multi-site: push to the SAME site the post lives on (not the user's
    // default). Edits to a Wine post must hit the Wine site's WP API.
    const site = await getWordPressCredentials(
      supabase,
      user.id,
      (post as { wordpress_site_id?: string | null }).wordpress_site_id,
    )
    if (!site) {
      return NextResponse.json({ ok: true, pushedToWp: false, warning: 'Saved, but WordPress not connected.' })
    }

    try {
      const wpService = createWordPressService(
        site.wordpress_url, site.wordpress_username, site.wordpress_app_password, site.wordpress_api_token || undefined,
      )
      await wpService.updatePost(post.wordpress_post_id, { content })
      return NextResponse.json({ ok: true, pushedToWp: true })
    } catch (err: unknown) {
      if (isStalePostError(err)) {
        return NextResponse.json({ ok: true, pushedToWp: false, warning: WP_STALE_POST_MESSAGE })
      }
      const msg = err instanceof Error ? err.message : 'WordPress update failed'
      return NextResponse.json({ ok: true, pushedToWp: false, warning: `Saved locally but WordPress update failed: ${msg}` })
    }
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
