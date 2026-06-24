/**
 * POST /api/pinterest/video-pin — publish a VIDEO pin (cross-post target).
 *
 * Body: { videoUrl, coverImageUrl, link, title?, description?, boardName? }
 *   - videoUrl       a vertical render we host (burner output / stored Short)
 *   - coverImageUrl  required by Pinterest for video pins (a frame/thumbnail)
 *   - link           the destination — MUST be a real page (blog/site), never an
 *                    affiliate redirect (Pinterest + Amazon Associates ToS)
 *
 * Resolves the board (named fallback → "Reviews", auto-created). Studio+ feature.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { PinterestService } from '@/services/pinterest'
import { scrubBanned } from '@/lib/scrub'
import { recordUsage } from '@/lib/ai-usage'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_BYTES = 300 * 1024 * 1024

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { videoUrl?: string; coverImageUrl?: string; link?: string; title?: string; description?: string; boardName?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const videoUrl = (body.videoUrl || '').trim()
  if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'A video URL is required.' }, { status: 400 })
  // Cover image: use the one passed (e.g. a post's featured image), else derive
  // a first-frame JPG from the video when it's a Cloudinary asset (burner output
  // always is). Pinterest requires a cover for video pins.
  let coverImageUrl = (body.coverImageUrl || '').trim()
  if (!coverImageUrl && /res\.cloudinary\.com\/.+\/video\/upload\//i.test(videoUrl)) {
    coverImageUrl = videoUrl.replace('/video/upload/', '/video/upload/so_0,w_720,c_fill/').replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, '.jpg')
  }
  if (!/^https:\/\//i.test(coverImageUrl)) return NextResponse.json({ error: 'Pinterest video pins need a cover image (pass coverImageUrl, or use a Cloudinary-hosted video so MVP can derive one).' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRaw } = await supabase.from('integrations').select('*').eq('user_id', user.id).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = decryptIntegrationRow(intRaw as any)
  // Destination link: an explicit page (the blog post) wins; otherwise fall back
  // to the creator's own blog homepage. NEVER an affiliate redirect (Pinterest +
  // Amazon ToS) — both of these are the creator's own site, which is compliant.
  const link = (body.link || '').trim() || (ig?.wordpress_url || '').trim()
  if (!/^https?:\/\//i.test(link)) return NextResponse.json({ error: 'Set your blog/site URL (or pass a link) — Pinterest pins must link to a real page, not an affiliate redirect.' }, { status: 400 })
  const tier = (ig?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'pinterest')) {
    return NextResponse.json({ error: 'Pinterest is a Studio plan feature.' }, { status: 403 })
  }
  if (!ig?.pinterest_access_token) {
    return NextResponse.json({ error: "Pinterest isn't connected. Connect it in Integrations first.", reconnectRequired: true }, { status: 412 })
  }

  // Pull the video bytes (the render lives on our storage / Cloudinary).
  let bytes: Uint8Array
  try {
    const res = await fetch(videoUrl)
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'Video is over 300MB.' }, { status: 400 })
    bytes = new Uint8Array(buf)
  } catch (e) {
    return NextResponse.json({ error: `Couldn't read the video: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }

  const title = (scrubBanned(body.title || '') || 'New video').slice(0, 100)
  const description = scrubBanned(body.description || '').slice(0, 500)

  try {
    const pinterest = new PinterestService(ig.pinterest_access_token)
    const fbName = (ig.pinterest_fallback_board || '').trim() || ig.pinterest_board_name || 'Reviews'
    const board = await pinterest.findOrCreateBoard(fbName)
    const { id } = await pinterest.createVideoPin({
      boardId: board.id, title, description, link, videoBytes: bytes, contentType: 'video/mp4', coverImageUrl,
    })
    recordUsage({ userId: user.id, tier, feature: 'pinterest_video_pin', model: 'pinterest-api', images: 1 })
    return NextResponse.json({ ok: true, pinId: id })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Pinterest video pin failed.' }, { status: 502 })
  }
}
