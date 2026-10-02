// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/youtube/first-comment/videos — the creator's YouTube videos with
// their pinned first comment, for the older videos tool (LABS). Newest first.
//
// ?missing=1 lists only the videos with no first comment yet (and ones whose
// first comment could not be posted, which can be tried again). ?q= filters
// by title. ?offset= and ?limit= page through the list.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { productLinkIn } from '@/lib/first-comment-text'

export const runtime = 'nodejs'
export const maxDuration = 30

const SCAN = 3000

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('first_comment', intg?.tier)) {
    return NextResponse.json({ error: 'Pinned Comments are part of Pro.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const url = new URL(req.url)
  const missing = url.searchParams.get('missing') === '1'
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase()
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  // READ IN PAGES. A request returns 1,000 rows at most whatever the limit
  // says, so a channel with 2,500 videos showed 1,000, its counts were wrong,
  // and "truncated" (set at 3,000) could never be true.
  async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>, cap: number) {
    const rows: T[] = []
    for (let from = 0; from < cap; from += 1000) {
      const { data, error } = await build(from, Math.min(cap, from + 1000) - 1)
      if (error) return { rows, error }
      rows.push(...(data ?? []))
      if ((data ?? []).length < 1000) break
    }
    return { rows, error: null }
  }
  const { rows: vids, error } = await readAll<{ youtube_video_id: string; title: string | null; description: string | null; thumbnail_url: string | null; published_at: string | null; view_count: number | null }>((from, to) => sb.from('youtube_videos')
    .select('youtube_video_id,title,description,thumbnail_url,published_at,view_count')
    .eq('user_id', user.id).not('youtube_video_id', 'is', null)
    .order('published_at', { ascending: false, nullsFirst: false }).order('id').range(from, to), SCAN)
  if (error) return NextResponse.json({ error: `Could not read your videos: ${error.message}` }, { status: 500 })

  const { rows: fcs, error: fErr } = await readAll<{ id: string; youtube_video_id: string; state: string; comment_id: string | null; pinned: boolean | null; pin_error: string | null; last_error: string | null; text: string; posted_at: string | null }>((from, to) => sb.from('video_first_comments')
    .select('id,youtube_video_id,state,comment_id,pinned,pin_error,last_error,text,posted_at')
    .eq('user_id', user.id).order('id').range(from, to), 20000)
  const missingTable = !!fErr && fErr.code === '42P01'
  const byVideo = new Map<string, { id: string; state: string; comment_id: string | null; pinned: boolean | null; pin_error: string | null; last_error: string | null; text: string; posted_at: string | null }>()
  for (const f of (fcs ?? [])) byVideo.set(f.youtube_video_id, f)

  type V = { youtube_video_id: string; title: string | null; description: string | null; thumbnail_url: string | null; published_at: string | null; view_count: number | null }
  let list = ((vids ?? []) as V[]).filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.youtube_video_id))
  if (q) list = list.filter((v) => String(v.title || '').toLowerCase().includes(q))
  const withFc = list.map((v) => ({ v, fc: byVideo.get(v.youtube_video_id) ?? null }))
  const shown = missing ? withFc.filter((x) => !x.fc || x.fc.state === 'failed' || x.fc.state === 'cancelled') : withFc

  return NextResponse.json({
    ok: true,
    missingTable,
    total: shown.length,
    // Counted over everything read, so the header can say how far along it is.
    counts: {
      videos: withFc.length,
      pinned: withFc.filter((x) => x.fc?.state === 'posted' && x.fc.pinned === true).length,
      postedNotPinned: withFc.filter((x) => x.fc?.state === 'posted' && x.fc.pinned !== true).length,
      // Being posted counts with waiting: it is on its way, not missing.
      waiting: withFc.filter((x) => x.fc?.state === 'waiting' || x.fc?.state === 'posting').length,
      none: withFc.filter((x) => !x.fc || x.fc.state === 'failed' || x.fc.state === 'cancelled').length,
    },
    truncated: (vids ?? []).length >= SCAN,
    videos: shown.slice(offset, offset + limit).map(({ v, fc }) => ({
      youtubeVideoId: v.youtube_video_id,
      title: v.title,
      thumbnailUrl: v.thumbnail_url,
      publishedAt: v.published_at,
      views: v.view_count,
      // Whether the comment will carry a product link, so the list can say.
      productLink: productLinkIn(v.description),
      firstComment: fc ? { id: fc.id, state: fc.state, commentId: fc.comment_id, pinned: fc.pinned, pinError: fc.pin_error, lastError: fc.last_error, text: fc.text, postedAt: fc.posted_at } : null,
    })),
  })
}
