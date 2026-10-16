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
 *
 * PINTEREST PROCESSES A VIDEO ON ITS OWN CLOCK, often past this route's time
 * limit (Seb, 2026-10-13: a clip pin from the TikTok window never appeared).
 * So the route waits about 90 seconds; if Pinterest is still processing, it
 * answers 202 { pending, finish } and the page sends `finish` back until the
 * pin is made (lib/pinterest-video-pin.ts). Nothing is lost to a timeout.
 */
import { trackPost } from '@/lib/reach-pulse'
import { isBlockedPinLink } from '@/lib/pinterest-destination'
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getPublishContext } from '@/lib/agency-publish'
import { decryptIntegrationRow } from '@/lib/integration-secrets'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { PinterestService } from '@/services/pinterest'
import { remoteVideoPosterUrl, uploadedVideoPosterUrl } from '@/services/cloudinary'
import { scrubBanned, scrubTitle } from '@/lib/scrub'
import { recordUsage } from '@/lib/ai-usage'
import { assertPublicHttpUrl } from '@/lib/ssrf-guard'
import { fetchWithTimeout, UPLOAD_TIMEOUT_MS } from '@/lib/fetch-timeout'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_BYTES = 300 * 1024 * 1024

export async function POST(request: Request) {
  // A Virtual Assistant publishes through the owner's accounts (lib/agency-publish).
  const pub = await getPublishContext(await createServerClient())
  if ('error' in pub) return pub.error
  const { supabase, user } = pub

  let body: { videoUrl?: string; coverImageUrl?: string; link?: string; title?: string; description?: string; boardName?: string; youtubeVideoId?: string; linkTarget?: string; finish?: PinFinish }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }
  if (body.finish) return finishPin(supabase, user.id, body.finish)
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
  // Remote fetch refused (Seb, 2026-10-16: a clip's pin failed with no
  // cover): upload the clip to Cloudinary and take its first frame, then, last,
  // the thumbnail of the YouTube video the clip came from.
  if (!/^https:\/\//i.test(coverImageUrl)) {
    coverImageUrl = (await uploadedVideoPosterUrl(videoUrl)) || ''
  }
  const coverYt = (body.youtubeVideoId || '').trim()
  if (!/^https:\/\//i.test(coverImageUrl) && /^[\w-]{11}$/.test(coverYt)) {
    coverImageUrl = `https://i.ytimg.com/vi/${coverYt}/hqdefault.jpg`
  }
  if (!/^https:\/\//i.test(coverImageUrl)) return NextResponse.json({ error: 'MVP could not make a cover image for this video, and Pinterest needs one for a video pin. Try again in a minute; if it keeps failing, the video file may not be reachable.' }, { status: 400 })

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
  // A short or redirect link is what Pinterest blocks as spam; never send one.
  if (rawLink && isBlockedPinLink(rawLink)) {
    return NextResponse.json({ error: 'Pinterest blocks short and redirect links, so this pin was not published. Use the blog post, the Link in Bio page or the full Amazon link.' }, { status: 400 })
  }
  const link = rawLink || undefined
  const tier = (ig?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'pinterest')) {
    return NextResponse.json({ error: 'Pinterest is on the Amazon and Pro plans.' }, { status: 403 })
  }
  if (!ig?.pinterest_access_token) {
    return NextResponse.json({ error: "Pinterest isn't connected. Connect it in Integrations first.", reconnectRequired: true }, { status: 412 })
  }

  // Pull the video bytes (the render lives on our storage / Cloudinary).
  let bytes: Uint8Array
  try {
    // A whole video off a CDN — upload budget, not the API-call default.
    const res = await fetchWithTimeout(videoUrl, { timeoutMs: UPLOAD_TIMEOUT_MS })
    if (!res.ok) throw new Error(`fetch ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: 'Video is over 300MB.' }, { status: 400 })
    bytes = new Uint8Array(buf)
  } catch (e) {
    return NextResponse.json({ error: `Couldn't read the video: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }

  const title = (scrubTitle(body.title || '') || 'New video').slice(0, 100)
  const description = scrubBanned(body.description || '').slice(0, 500)

  try {
    const pinterest = new PinterestService(ig.pinterest_access_token)
    const fbName = (ig.pinterest_fallback_board || '').trim() || ig.pinterest_board_name || 'Reviews'
    const board = await pinterest.findOrCreateBoard(fbName)
    const mediaId = await pinterest.startVideoMedia(bytes, 'video/mp4')
    const finish: PinFinish = { mediaId, boardId: board.id, boardName: fbName, title, description, link, coverImageUrl }
    let status = 'registered'
    const waitUntil = Date.now() + 90_000
    while (status !== 'succeeded' && Date.now() < waitUntil) {
      await new Promise(r => setTimeout(r, 3000))
      status = await pinterest.videoMediaStatus(mediaId, status)
      if (status === 'failed') throw new Error('Pinterest could not process the video.')
    }
    if (status !== 'succeeded') return NextResponse.json({ ok: false, pending: true, status, finish }, { status: 202 })
    const { id } = await pinterest.pinFromVideoMedia({ boardId: board.id, title, description, link, mediaId, coverImageUrl })
    recordUsage({ userId: user.id, tier, feature: 'pinterest_video_pin', model: 'pinterest-api', images: 1 })
    // PULSE ON EVERY PLATFORM (lib/reach-pulse trackPost).
    await trackPost({ userId: user.id, platform: 'pinterest', postId: id, caption: description, productText: title })
    return NextResponse.json({ ok: true, pinId: id, board: fbName })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Pinterest video pin failed.'
    console.warn('[pinterest/video-pin] failed for', user.id, '—', msg, '| cover:', coverImageUrl.slice(0, 80), '| video:', videoUrl.slice(0, 80))
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

/** What the page sends back to finish a pin Pinterest was still processing. */
type PinFinish = { mediaId: string; boardId: string; boardName?: string; title: string; description: string; link?: string; coverImageUrl: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finishPin(supabase: any, userId: string, f: PinFinish) {
  const mediaId = String(f?.mediaId || '')
  const boardId = String(f?.boardId || '')
  const cover = String(f?.coverImageUrl || '')
  const link = f?.link ? String(f.link) : undefined
  // The same rules as the first send: Pinterest's own ids, a real cover, and
  // never a short or redirect link.
  if (!/^\d{3,30}$/.test(mediaId) || !/^\d{3,30}$/.test(boardId) || !/^https:\/\//i.test(cover)) return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  if (link && (!/^https?:\/\//i.test(link) || isBlockedPinLink(link))) return NextResponse.json({ error: 'Pinterest blocks short and redirect links, so this pin was not published.' }, { status: 400 })
  const { data: intRaw } = await supabase.from('integrations').select('*').eq('user_id', userId).single()
  const ig = decryptIntegrationRow(intRaw)
  const tier = (ig?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'pinterest')) return NextResponse.json({ error: 'Pinterest is on the Amazon and Pro plans.' }, { status: 403 })
  if (!ig?.pinterest_access_token) return NextResponse.json({ error: "Pinterest isn't connected. Connect it in Integrations first.", reconnectRequired: true }, { status: 412 })
  try {
    const pinterest = new PinterestService(ig.pinterest_access_token)
    const status = await pinterest.videoMediaStatus(mediaId, 'processing')
    if (status === 'failed') return NextResponse.json({ error: 'Pinterest could not process the video.' }, { status: 502 })
    if (status !== 'succeeded') return NextResponse.json({ ok: false, pending: true, status, finish: f }, { status: 202 })
    const title = (scrubTitle(String(f.title || '')) || 'New video').slice(0, 100)
    const description = scrubBanned(String(f.description || '')).slice(0, 500)
    const { id } = await pinterest.pinFromVideoMedia({ boardId, title, description, link, mediaId, coverImageUrl: cover })
    recordUsage({ userId, tier, feature: 'pinterest_video_pin', model: 'pinterest-api', images: 1 })
    // PULSE ON EVERY PLATFORM (lib/reach-pulse trackPost).
    await trackPost({ userId, platform: 'pinterest', postId: id, caption: description, productText: title })
    return NextResponse.json({ ok: true, pinId: id, board: f.boardName || null })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Pinterest video pin failed.' }, { status: 502 })
  }
}
