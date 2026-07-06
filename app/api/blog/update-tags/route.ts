/**
 * POST /api/blog/update-tags
 *
 * Persist the per-video brand tags/keywords (up to 5) a creator was asked to
 * include, to youtube_videos.brand_tags. The next blog generate inserts them
 * VERBATIM at the very top of the article. Owner-scoped; mirrors the
 * update-category save pattern next to it on the Content page.
 *
 * Body: { videoId: string, tags: string | null }
 *   tags = '' or null clears them. More than 5 comma-separated items → capped
 *   to the first 5. Stored normalized ("a, b, c") so it round-trips cleanly.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { videoId, tags } = await request.json() as { videoId?: string; tags?: string | null }
    if (!videoId) return NextResponse.json({ error: 'videoId required' }, { status: 400 })

    // Cap to 5 comma-separated items, trim each, drop blanks. Cap each item's
    // length too so a paste can't balloon the top of the post.
    const items = (tags ?? '')
      .split(',')
      .map(t => t.trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 5)
    const normalized = items.length ? items.join(', ') : null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('youtube_videos') as any)
      .update({ brand_tags: normalized })
      .eq('id', videoId)
      .eq('user_id', user.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, tags: normalized })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Bad request' }, { status: 400 })
  }
}
