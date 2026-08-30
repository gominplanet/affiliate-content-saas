// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// POST /api/launchpad/master — turn an uploaded (file-first) video into the
// storefront master, so Launchpad can run the Amazon geos + dub without the
// video ever being on YouTube. Creates a youtube_videos row pointing at the
// rendered file, tags it with the product (ASIN), and transcribes it so dubs
// have a script. Returns the row id to use as the Storefront Sync master.
//   body: { title, videoUrl, asin }  ->  { ok, videoId }
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { normalizeTier } from '@/lib/tier'
import { transcribeToCues, transcriptionConfigured } from '@/lib/shorts-transcribe'
import { cuesToText } from '@/lib/shorts-transcript'
import { buildProductThumbnail } from '@/lib/product-thumbnail'

export const runtime = 'nodejs'
export const maxDuration = 300

function asinFrom(v: string): string | null {
  const s = (v || '').trim()
  if (/^[A-Z0-9]{10}$/i.test(s)) return s.toUpperCase()
  const m = s.match(/\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})/i)
  return m ? m[1].toUpperCase() : null
}

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integ } = await supabase.from('integrations').select('tier').eq('user_id', user.id).maybeSingle()
  const tier = normalizeTier(integ?.tier)
  if (!['pro', 'admin'].includes(tier)) {
    return NextResponse.json({ error: 'Launchpad is a Pro feature.', code: 'tier_not_allowed' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { title?: string; videoUrl?: string; asin?: string }
  const title = (body.title || 'My video').trim().slice(0, 200)
  const videoUrl = (body.videoUrl || '').trim()
  const asin = asinFrom(body.asin || '')
  if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'A hosted video URL is required.' }, { status: 400 })
  if (!asin) return NextResponse.json({ error: 'A valid product ASIN is required.' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const productUrl = `https://www.amazon.com/dp/${asin}`

  // Create the master row FAST and return, so the UI never hangs. The heavy
  // work (transcription for dubs, the branded thumbnail) is enriched in the
  // background and also lazily on demand — the dub route transcribes the source
  // if it's still missing when a dub runs, so nothing depends on this finishing.
  const { data: row, error } = await sb
    .from('youtube_videos')
    .insert({
      // Not a real YouTube id (this video isn't on YouTube). A synthetic
      // "upload-<uuid>" satisfies the not-null constraint and is deliberately
      // NOT 11 chars, so the 11-char YouTube-id guards elsewhere skip it and
      // never try to pull it from YouTube (we dub from source_video_url).
      user_id: user.id,
      youtube_video_id: `upload-${crypto.randomUUID()}`,
      title,
      source_video_url: videoUrl,
      product_url: productUrl,
      published_at: new Date().toISOString(),
    })
    .select('id').single()
  if (error || !row) return NextResponse.json({ error: error?.message || 'Could not create the master.' }, { status: 500 })

  // Fire-and-forget enrichment. Best-effort: the dub route re-transcribes on
  // demand if this doesn't finish, and the thumbnail isn't on the critical path.
  void (async () => {
    try {
      const [t, thumb] = await Promise.allSettled([
        (async () => transcriptionConfigured() ? cuesToText(await transcribeToCues(videoUrl)).slice(0, 20000) : '')(),
        buildProductThumbnail(sb, { userId: user.id, tier, title, asin }),
      ])
      const transcript = t.status === 'fulfilled' ? t.value : ''
      const thumbnailUrl = thumb.status === 'fulfilled' ? thumb.value : null
      const patch: Record<string, unknown> = {}
      if (transcript) patch.transcript = transcript
      if (thumbnailUrl) patch.thumbnail_url = thumbnailUrl
      if (Object.keys(patch).length) await sb.from('youtube_videos').update(patch).eq('id', row.id)
    } catch { /* best-effort */ }
  })()

  return NextResponse.json({ ok: true, videoId: row.id })
}
