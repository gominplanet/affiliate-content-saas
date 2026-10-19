// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/youtube/first-comment/videos — the creator's YouTube videos with
// their pinned first comment, for the older videos tool (LABS). Newest first.
//
// ?missing=1 lists only the videos with no first comment yet (and ones whose
// first comment could not be posted, which can be tried again). ?q= filters
// by title. ?offset= and ?limit= page through the list.
//
// HIDDEN VIDEOS (Seb, 2026-10-19: "we need to be able to get rid of these
// videos we do not want to see here", videos YouTube no longer has). Hidden
// ones are left out of the list and its counts; ?hidden=1 lists only them, to
// show them again. POST { hide: [ids] } or { unhide: [ids] } (migration 447).
// A video YouTube was asked about and does not show is marked `gone`, so the
// page can say so and hide them in one go; nothing is deleted.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { canUsePreview } from '@/lib/labs-preview'
import { productLinkIn } from '@/lib/first-comment-text'
import { createAdminClient } from '@/lib/supabase/admin'
import { fillMissingVideoDetails } from '@/lib/video-details-fill'

export const runtime = 'nodejs'
export const maxDuration = 30

const SCAN = 3000

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: intg } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  if (!canUsePreview('first_comment', intg?.tier)) {
    return NextResponse.json({ error: 'Pinned comments are part of the Pro plan.', code: 'tier_not_allowed' }, { status: 403 })
  }
  const hiddenRead = await readHidden(user.id)
  const hidden = new Set(hiddenRead.ids)
  const url = new URL(req.url)
  const missing = url.searchParams.get('missing') === '1'
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase()
  const onlyHidden = url.searchParams.get('hidden') === '1'
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
  const all = ((vids ?? []) as V[]).filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.youtube_video_id))
  const hiddenCount = all.filter((v) => hidden.has(v.youtube_video_id)).length
  let list = all.filter((v) => hidden.has(v.youtube_video_id) === onlyHidden)
  if (q) list = list.filter((v) => String(v.title || '').toLowerCase().includes(q))
  const withFc = list.map((v) => ({ v, fc: byVideo.get(v.youtube_video_id) ?? null }))
  const shown = missing ? withFc.filter((x) => !x.fc || x.fc.state === 'failed' || x.fc.state === 'cancelled') : withFc

  // VIDEOS KNOWN ONLY BY ID get their real title, description and thumbnail
  // from YouTube before they are shown (lib/video-details-fill), so the list
  // never says "no product link" about a description MVP never read.
  const page = shown.slice(offset, offset + limit)
  const bare = page.filter(({ v }) => !String(v.title || '').trim() || v.description == null).map(({ v }) => v.youtube_video_id)
  // Asked and not shown: YouTube no longer has it (or it is private on a
  // channel MVP cannot see). Said, never deleted here.
  const asked = new Set<string>()
  const gone = new Set<string>()
  if (bare.length) {
    const filled = await fillMissingVideoDetails(createAdminClient(), user.id, bare, asked).catch(() => new Map())
    for (const id of bare) if (asked.has(id) && !filled.has(id)) gone.add(id)
    for (const x of page) {
      const f = filled.get(x.v.youtube_video_id)
      if (!f) continue
      if (!String(x.v.title || '').trim()) x.v.title = f.title || x.v.title
      if (x.v.description == null || !String(x.v.description).trim()) x.v.description = f.description
      if (!x.v.thumbnail_url) x.v.thumbnail_url = f.thumbnailUrl
    }
  }

  return NextResponse.json({
    ok: true,
    missingTable,
    total: shown.length,
    hiddenCount,
    // Without migration 447 nothing can be hidden: said, not silently ignored.
    hidingMissing: hiddenRead.missing,
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
    videos: page.map(({ v, fc }) => ({
      youtubeVideoId: v.youtube_video_id,
      title: v.title,
      thumbnailUrl: v.thumbnail_url,
      publishedAt: v.published_at,
      views: v.view_count,
      // Whether the comment will carry a product link, so the list can say.
      productLink: productLinkIn(v.description),
      // Null description: never read, so "no link" would be a guess.
      descriptionKnown: v.description != null,
      gone: gone.has(v.youtube_video_id),
      firstComment: fc ? { id: fc.id, state: fc.state, commentId: fc.comment_id, pinned: fc.pinned, pinError: fc.pin_error, lastError: fc.last_error, text: fc.text, postedAt: fc.posted_at } : null,
    })),
  })
}

type Admin = ReturnType<typeof createAdminClient>
async function readHidden(userId: string, admin: Admin = createAdminClient()): Promise<{ ids: string[]; missing: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any).from('integrations').select('first_comment_hidden').eq('user_id', userId).maybeSingle()
  if (error) return { ids: [], missing: /first_comment_hidden|does not exist|schema cache/i.test(error.message) }
  return { ids: Array.isArray(data?.first_comment_hidden) ? data.first_comment_hidden : [], missing: false }
}

/** Hide videos from Pinned comments, or show them again. The videos and
 *  their comments are not touched. */
export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as { hide?: unknown; unhide?: unknown }
  const ids = (v: unknown) => (Array.isArray(v) ? v : []).map(String).filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id)).slice(0, 500)
  const hide = ids(body.hide), unhide = new Set(ids(body.unhide))
  if (!hide.length && !unhide.size) return NextResponse.json({ error: 'Which videos?' }, { status: 400 })
  const admin = createAdminClient()
  const had = await readHidden(user.id, admin)
  if (had.missing) return NextResponse.json({ error: 'Hiding needs migration 447 (first_comment_hidden). Nothing was hidden.' }, { status: 500 })
  const next = Array.from(new Set([...had.ids.filter((id) => !unhide.has(id)), ...hide])).slice(-5000)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('integrations').update({ first_comment_hidden: next }).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: `Not saved: ${error.message}` }, { status: 500 })
  return NextResponse.json({ ok: true, hidden: next.length })
}
