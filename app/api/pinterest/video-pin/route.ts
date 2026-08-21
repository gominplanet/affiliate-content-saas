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
import { remoteVideoPosterUrl } from '@/services/cloudinary'
import { scrubBanned } from '@/lib/scrub'
import { recordUsage } from '@/lib/ai-usage'
import { assertPublicHttpUrl } from '@/lib/ssrf-guard'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_BYTES = 300 * 1024 * 1024

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { videoUrl?: string; coverImageUrl?: string; link?: string; title?: string; description?: string; boardName?: string; youtubeVideoId?: string; linkTarget?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  const videoUrl = (body.videoUrl || '').trim()
  if (!/^https:\/\//i.test(videoUrl)) return NextResponse.json({ error: 'A video URL is required.' }, { status: 400 })
  // SSRF guard: the render bytes get fetched server-side below. Legit renders
  // live on our storage / Cloudinary (public hosts) — reject private/reserved/
  // metadata hosts a body could smuggle in.
  try { assertPublicHttpUrl(videoUrl) } catch { return NextResponse.json({ error: 'That video URL host isn’t allowed.' }, { status: 400 }) }
  // Cover image: use the one passed (e.g. a post's featured image), else derive
  // a first-frame JPG from the video when it's a Cloudinary asset (burner output
  // always is). Pinterest requires a cover for video pins.
  let coverImageUrl = (body.coverImageUrl || '').trim()
  if (!coverImageUrl && /res\.cloudinary\.com\/.+\/video\/upload\//i.test(videoUrl)) {
    coverImageUrl = videoUrl.replace('/video/upload/', '/video/upload/so_0,w_720,c_fill/').replace(/\.(mp4|mov|webm|m4v)(\?.*)?$/i, '.jpg')
  }
  // Clips rendered OFF Cloudinary (the Shorts "ingest" engine returns an
  // external .mp4) have no native frame to derive — grab a poster frame from
  // any video host via Cloudinary remote fetch so the pin still gets a cover.
  if (!/^https:\/\//i.test(coverImageUrl)) {
    coverImageUrl = (await remoteVideoPosterUrl(videoUrl)) || ''
  }
  if (!/^https:\/\//i.test(coverImageUrl)) return NextResponse.json({ error: 'Pinterest video pins need a cover image (pass coverImageUrl, or use a Cloudinary-hosted video so MVP can derive one).' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRaw } = await supabase.from('integrations').select('*').eq('user_id', user.id).single()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ig = decryptIntegrationRow(intRaw as any)
  // Destination link (NEVER an affiliate redirect — Pinterest + Amazon ToS;
  // every option here is the creator's own page). The TARGET is the creator's
  // saved preference (integrations.pinterest_link_pref), overridable per-request:
  //   'auto'      blog post for this clip's video → the video → homepage
  //   'blog_post' the blog post (else homepage)
  //   'youtube'   the video the clip came from (else homepage)
  //   'homepage'  always the blog homepage
  // Only a MALFORMED link is rejected; an absent one just means a linkless pin.
  const ALLOWED_TARGETS = new Set(['auto', 'blog_post', 'youtube', 'homepage'])
  const reqTarget = (body.linkTarget || '').trim()
  const savedTarget = (ig?.pinterest_link_pref as string) || 'auto'
  const target = ALLOWED_TARGETS.has(reqTarget) ? reqTarget : (ALLOWED_TARGETS.has(savedTarget) ? savedTarget : 'auto')

  const callerLink = (body.link || '').trim()  // the YouTube watch URL the modal passes
  const homepage = (ig?.wordpress_url || '').trim()
  const ytId = (body.youtubeVideoId || '').trim()

  // Resolve a published blog post for the clip's source video (for auto/blog_post).
  let blogPostLink = ''
  if ((target === 'auto' || target === 'blog_post') && ytId) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any
      const { data: yv } = await sb.from('youtube_videos').select('id').eq('user_id', user.id).eq('youtube_video_id', ytId).maybeSingle()
      if (yv?.id) {
        const { data: bp } = await sb.from('blog_posts')
          .select('wordpress_url').eq('user_id', user.id).eq('video_id', yv.id)
          .not('wordpress_url', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (bp?.wordpress_url) blogPostLink = String(bp.wordpress_url).trim()
      }
    } catch { /* no post / lookup failed */ }
  }

  const rawLink = (
    target === 'homepage' ? homepage
    : target === 'youtube' ? (callerLink || homepage)
    : target === 'blog_post' ? (blogPostLink || homepage)
    : /* auto */ (blogPostLink || callerLink || homepage)
  )
  if (rawLink && !/^https?:\/\//i.test(rawLink)) {
    return NextResponse.json({ error: 'That link isn’t a valid URL. Leave it blank to pin the video with no link, or use your blog/site URL — never an affiliate redirect.' }, { status: 400 })
  }
  const link = rawLink || undefined
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
    const msg = e instanceof Error ? e.message : 'Pinterest video pin failed.'
    console.warn('[pinterest/video-pin] failed for', user.id, '—', msg, '| cover:', coverImageUrl.slice(0, 80), '| video:', videoUrl.slice(0, 80))
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
