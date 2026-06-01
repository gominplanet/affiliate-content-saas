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

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const postId = new URL(request.url).searchParams.get('postId')
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await supabase
      .from('blog_posts')
      .select('content,title')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: post } = await supabase
      .from('blog_posts')
      .select('id,wordpress_post_id')
      .eq('id', postId)
      .eq('user_id', user.id)
      .single()
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updErr } = await supabase
      .from('blog_posts')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', postId)
      .eq('user_id', user.id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    if (!post.wordpress_post_id) {
      return NextResponse.json({ ok: true, pushedToWp: false, reason: 'no_wp_post' })
    }

    const { data: wpRow } = await supabase
      .from('integrations')
      .select('wordpress_url,wordpress_username,wordpress_app_password,wordpress_api_token')
      .eq('user_id', user.id)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wp = wpRow as any
    if (!wp?.wordpress_url) {
      return NextResponse.json({ ok: true, pushedToWp: false, warning: 'Saved, but WordPress not connected.' })
    }

    try {
      const wpService = createWordPressService(
        wp.wordpress_url, wp.wordpress_username, wp.wordpress_app_password, wp.wordpress_api_token || undefined,
      )
      await wpService.updatePost(post.wordpress_post_id, { content })
      return NextResponse.json({ ok: true, pushedToWp: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'WordPress update failed'
      return NextResponse.json({ ok: true, pushedToWp: false, warning: `Saved locally but WordPress update failed: ${msg}` })
    }
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
