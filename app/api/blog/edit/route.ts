// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET  /api/blog/edit?postId=…  → { title, content, status, wordpressUrl,
//                                   scheduledFor, wpPostId } for the in-app editor.
// PATCH /api/blog/edit  { postId, title, content }
//   → save the edited article back to blog_posts AND re-push it to WordPress
//     (updatePost title+content). Works for a LIVE post and a SCHEDULED one
//     (WP holds the scheduled post as status=future; updating its content is
//     fine and the future publish still fires at its post_date).
//
// This is what lets a creator edit a post right inside MVP instead of opening
// WP admin. Session-authed + owner-scoped (blog_posts RLS is per-user).
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createWordPressService } from '@/services/wordpress'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export const runtime = 'nodejs'
export const maxDuration = 60

interface PostRow {
  id: string
  title: string | null
  content: string | null
  status: string | null
  wordpress_url: string | null
  wordpress_post_id: number | null
  wordpress_site_id: string | null
  scheduled_for: string | null
}

export async function GET(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const postId = new URL(request.url).searchParams.get('postId') || ''
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row } = await (supabase as any)
      .from('blog_posts')
      .select('id,title,content,status,wordpress_url,wordpress_post_id,wordpress_site_id,scheduled_for')
      .eq('id', postId).eq('user_id', user.id).maybeSingle()
    if (!row) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    const p = row as PostRow

    return NextResponse.json({
      postId: p.id,
      title: p.title ?? '',
      content: p.content ?? '',
      status: p.status ?? null,
      wordpressUrl: p.wordpress_url ?? null,
      wpPostId: p.wordpress_post_id ?? null,
      scheduledFor: p.scheduled_for ?? null,
      hasBody: !!(p.content && p.content.trim()),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load post.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await request.json().catch(() => ({})) as { postId?: string; title?: string; content?: string }
    const postId = (body.postId || '').trim()
    if (!postId) return NextResponse.json({ error: 'postId required' }, { status: 400 })
    const title = typeof body.title === 'string' ? body.title.trim() : undefined
    const content = typeof body.content === 'string' ? body.content : undefined
    if (title == null && content == null) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
    if (title != null && !title) return NextResponse.json({ error: 'Title cannot be empty.' }, { status: 400 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any
    const { data: row } = await sb
      .from('blog_posts')
      .select('id,wordpress_post_id,wordpress_site_id')
      .eq('id', postId).eq('user_id', user.id).maybeSingle()
    if (!row) return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    const p = row as Pick<PostRow, 'id' | 'wordpress_post_id' | 'wordpress_site_id'>

    // 1. Save to blog_posts (source of truth MVP reads from).
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (title != null) patch.title = title
    if (content != null) patch.content = content
    const { error: dbErr } = await sb.from('blog_posts').update(patch).eq('id', postId).eq('user_id', user.id)
    if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

    // 2. Re-push to WordPress if the post exists there (live or scheduled).
    let wpUpdated = false
    let wpError: string | null = null
    if (p.wordpress_post_id) {
      try {
        const creds = await getWordPressCredentials(supabase, user.id, p.wordpress_site_id ?? null)
        if (!creds) throw new Error('WordPress site not connected.')
        const wp = createWordPressService(creds.wordpress_url, creds.wordpress_username, creds.wordpress_app_password, creds.wordpress_api_token || undefined)
        const wpPatch: Record<string, unknown> = {}
        if (title != null) wpPatch.title = title
        if (content != null) wpPatch.content = content
        await wp.updatePost(p.wordpress_post_id, wpPatch as never)
        wpUpdated = true
      } catch (e) {
        // Saved to MVP even if WP push failed — surface it so the user can retry.
        wpError = e instanceof Error ? e.message : 'WordPress update failed.'
      }
    }

    return NextResponse.json({ ok: true, wpUpdated, wpError })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to save post.' }, { status: 500 })
  }
}
