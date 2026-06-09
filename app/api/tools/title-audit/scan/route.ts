/**
 * POST /api/tools/title-audit/scan
 *
 * Pulls every published blog post for the caller and runs
 * factCheckTitleVsBody on each. Returns the list of MISMATCHES — posts
 * whose title's product doesn't match the body's product (the
 * WagComb-class hallucination that slipped past the per-step fact-checks
 * before the title-vs-body check shipped).
 *
 * Body: { limit?: number, offset?: number, dryRun?: boolean }
 *   - limit: cap per call to avoid Vercel timeout (default 25)
 *   - offset: pagination — caller drives a loop via repeated calls
 *
 * Returns: { mismatches, scannedCount, hasMore }
 *
 * Access: Creator+ (trial blocked — they have ≤5 lifetime posts so
 * there's nothing meaningful to audit). Each query is scoped to
 * `user_id = caller` so users only walk their own archive — no
 * cross-tenant exposure. Title hallucinations hurt the user's site
 * reputation, not ours, so they deserve the tool. Opened from
 * admin-only 2026-06-07.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { createClaudeService } from '@/services/claude'
import { normalizeTier, type Tier } from '@/lib/tier'
import { getAuthAndOwner } from '@/lib/agency-auth'

// Give the route headroom — 20 parallel Haiku calls usually finish in
// ~2-4s, but slow ones can take 10s+. The default 10s Vercel timeout
// would 504 the scan call mid-flight on a bad day. 2026-06-07.
export const maxDuration = 60

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
    // 2026-06-09 Phase 2 (VA): title audit scans owner's posts under owner's
    // tier. Caller's user.id is what AI usage tracks.
    const auth = await getAuthAndOwner(supabase)
    if (auth.error) return auth.error
    const { user, ownerId } = auth

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tierRow } = await supabase
      .from('integrations').select('tier').eq('user_id', ownerId).maybeSingle()
    const tier = normalizeTier((tierRow?.tier as Tier) ?? 'trial')
    // Trial is blocked (≤5 lifetime posts — nothing meaningful to audit
    // AND they could spam the route to burn Haiku). Every paying tier is
    // welcome. The user's tier is also passed to the Haiku helper below
    // so usage gets attributed correctly.
    if (tier === 'trial') {
      return NextResponse.json(
        { error: 'Upgrade to Creator or higher to scan your archive for title hallucinations.' },
        { status: 403 },
      )
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
      .eq('user_id', ownerId)
      .eq('status', 'published')
      .not('content', 'is', null)
      .order('published_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

    const claude = createClaudeService()

    // Parallelize the per-post Haiku checks. The previous serial loop
    // took ~1-2s per post × 25 = 25-50s per scan call. Promise.all
    // collapses that to the slowest single check (~2-3s) since Haiku
    // tolerates 20-50 concurrent requests easily. Cuts a 126-post
    // scan from ~3-5 minutes down to <30 seconds. 2026-06-07.
    type PostRow = { id: string; video_id: string | null; title: string; content: string; wordpress_post_id: number | null; wordpress_url: string }
    const results = await Promise.all(
      ((posts ?? []) as PostRow[]).map(async (p): Promise<Mismatch | null> => {
        if (!p.title || !p.content || p.content.length < 300) return null
        try {
          const newTitle = await claude.factCheckTitleVsBody(p.title, p.content, {
            userId: user.id,
            tier,
          })
          const cleaned = (newTitle || '').trim()
          if (!cleaned || cleaned === p.title.trim()) return null
          // Build a short body preview for the UI.
          const preview = p.content
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 240)
          return {
            postId: p.id,
            videoId: p.video_id,
            oldTitle: p.title,
            newTitle: cleaned,
            wordpressPostId: p.wordpress_post_id,
            wordpressUrl: p.wordpress_url,
            preview,
          }
        } catch {
          // Skip rows where the check throws — non-fatal for the batch.
          return null
        }
      }),
    )
    const mismatches: Mismatch[] = results.filter((m): m is Mismatch => m !== null)

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
