/**
 * GET /api/youtube/shorts/library — every clip Clip Factory ever rendered for
 * this creator, newest first, with whether its file is still there to post
 * (Seb, 2026-10-12: "a tab where it gives you all the clips that it's ever
 * created that are still available to post").
 *
 * The rendered clips are the deliverable and the retention sweep never
 * deletes them (cron/purge-shorts-sources removes only the long source
 * videos), but a file can still go missing (removed by hand, an old
 * Cloudinary asset). So each file is checked: available true, false when the
 * host says it is gone, null when the check itself could not answer. A clip is
 * never called gone on a timeout.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { rowToShort } from '@/lib/shorts-row'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_CLIPS = 200
const CHECK_POOL = 12

async function fileState(url: string): Promise<boolean | null> {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000) })
    if (r.ok) return true
    if (r.status === 404 || r.status === 410) return false
    return null
  } catch { return null }
}

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: rows, error } = await sb.from('youtube_shorts')
    .select('*')
    .eq('user_id', user.id).eq('status', 'rendered').not('rendered_url', 'is', null)
    .order('rendered_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false })
    .limit(MAX_CLIPS)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const list = (rows ?? []) as Array<Record<string, unknown>>
  // Still being made, so the list can say they are coming.
  const { count: rendering } = await sb.from('youtube_shorts')
    .select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', 'rendering')

  // The video each clip was cut from, for its title and picture.
  const videoIds = [...new Set(list.map((r) => String(r.video_id)).filter(Boolean))]
  const videos = new Map<string, { title: string | null; thumbnail: string | null }>()
  for (let i = 0; i < videoIds.length; i += 200) {
    const { data: vs } = await sb.from('youtube_videos').select('id,title,thumbnail_url').eq('user_id', user.id).in('id', videoIds.slice(i, i + 200))
    for (const v of (vs ?? []) as Array<{ id: string; title: string | null; thumbnail_url: string | null }>) videos.set(v.id, { title: v.title, thumbnail: v.thumbnail_url })
  }

  // Each file checked, a few at a time.
  const states: Array<boolean | null> = new Array(list.length).fill(null)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(CHECK_POOL, list.length) }, async () => {
    while (next < list.length) {
      const i = next++
      states[i] = await fileState(String(list[i].rendered_url))
    }
  }))

  return NextResponse.json({
    ok: true,
    capped: list.length >= MAX_CLIPS,
    rendering: rendering ?? 0,
    clips: list.map((r, i) => {
      const v = videos.get(String(r.video_id))
      return {
        ...rowToShort(r),
        renderedAt: (r.rendered_at as string | null) ?? (r.updated_at as string | null) ?? null,
        videoTitle: v?.title ?? null,
        videoThumbnail: v?.thumbnail ?? null,
        available: states[i],
      }
    }),
  })
}
