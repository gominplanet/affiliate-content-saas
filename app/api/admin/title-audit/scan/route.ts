/**
 * POST /api/admin/title-audit/scan
 *
 * Pulls every published blog post for the caller (admin only) and runs
 * factCheckTitleVsBody on each. Returns the list of MISMATCHES — posts
 * whose title's product doesn't match the body's product (the
 * WagComb-class hallucination that slipped past the per-step fact-checks
 * before today's fix).
 *
 * Body: { limit?: number, offset?: number, dryRun?: boolean }
 *   - limit: cap per call to avoid Vercel timeout (default 25)
 *   - offset: pagination — caller drives a loop via repeated calls
 *
 * Returns: { mismatches, scannedCount, hasMore }
 *
 * Why scoped to the caller (not cross-tenant): WP titles are user
 * content and we should not run vision/fact-check on other users'
 * posts. An admin still scans their own tenant's posts.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClaudeService } from '@/services/claude'

interface Mismatch {
  postId: string
  videoId: string | null
  oldTitle: string
  newTitle: string
  wordpressPostId: number | null
  wordpressUrl: string
  preview: string  // first 200 chars of body for context
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
    if (tierRow?.tier !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({})) as {
      limit?: number
      offset?: number
    }
    const limit = Math.min(50, Math.max(1, body.limit ?? 25))
    const offset = Math.max(0, body.offset ?? 0)

    // Pull posts. We need title + content + wp post id + url for each.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: posts, error: pErr, count } = await (supabase as any)
      .from('blog_posts')
      .select('id,video_id,title,content,wordpress_post_id,wordpress_url', { count: 'exact' })
      .eq('user_id', user.id)
      .eq('status', 'published')
      .not('content', 'is', null)
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

    const claude = createClaudeService()
    const mismatches: Mismatch[] = []

    for (const p of (posts ?? []) as Array<{ id: string; video_id: string | null; title: string; content: string; wordpress_post_id: number | null; wordpress_url: string }>) {
      if (!p.title || !p.content || p.content.length < 300) continue
      try {
        const newTitle = await claude.factCheckTitleVsBody(p.title, p.content, {
          userId: user.id,
          tier: 'admin',
        })
        const cleaned = (newTitle || '').trim()
        if (!cleaned || cleaned === p.title.trim()) continue
        // Build a short body preview for the UI.
        const preview = p.content
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 240)
        mismatches.push({
          postId: p.id,
          videoId: p.video_id,
          oldTitle: p.title,
          newTitle: cleaned,
          wordpressPostId: p.wordpress_post_id,
          wordpressUrl: p.wordpress_url,
          preview,
        })
      } catch {
        // Skip rows where the check throws — non-fatal for the batch.
      }
    }

    return NextResponse.json({
      mismatches,
      scannedCount: (posts ?? []).length,
      totalCount: count ?? null,
      hasMore: (count ?? 0) > offset + limit,
      nextOffset: offset + limit,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
