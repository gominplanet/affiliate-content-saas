/**
 * GET /api/campaigns/catalog/video-debug?asin=B0XXXXXXXX
 *
 * Probes a single ASIN's Amazon product page and returns a detailed
 * breakdown of what was found — verdict, response size, pattern matches,
 * and short HTML snippets around each potential video marker.
 *
 * Built 2026-06-09 after the carousel-video filter returned 0 matches on
 * 'solar' Top 20 with 0 bot challenges (i.e. every page WAS the real
 * product page but my patterns weren't matching). This endpoint lets us
 * see EXACTLY what the page contained so we can extend the patterns.
 *
 * Usage:
 *   curl 'https://www.mvpaffiliate.io/api/campaigns/catalog/video-debug?asin=B0GT4L8VZR'
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'mediaTypeCount: video > 0', pattern: /"mediaTypeCount"\s*:\s*\{[^}]*"video"\s*:\s*[1-9]/ },
  { label: 'videoUrl: https://', pattern: /"videoUrl"\s*:\s*"https?:\/\//i },
  { label: 'videoUrl: //', pattern: /"videoUrl"\s*:\s*"\/\//i },
  { label: 'videos: [{ (object array)', pattern: /"videos"\s*:\s*\[\s*\{/ },
  { label: 'videos: ["...] (url array)', pattern: /"videos"\s*:\s*\[\s*"/ },
  { label: 'data-video-url=', pattern: /data-video-url\s*=\s*["']https?:\/\//i },
  { label: 'id="videoBlock"', pattern: /id\s*=\s*["']videoBlock["']/ },
  { label: 'class with vse-video-player', pattern: /class\s*=\s*["'][^"']*vse-video-player/i },
  { label: '"isVideo": true', pattern: /"isVideo"\s*:\s*true/i },
  // 2026-06-09 — added fallbacks after the user reported 0 matches:
  { label: '.mp4 url in head', pattern: /https?:[^"' ]+\.mp4(\?[^"']*)?["']/i },
  { label: '.m3u8 (HLS) url', pattern: /https?:[^"' ]+\.m3u8(\?[^"']*)?["']/i },
  { label: 'videoBlockId key', pattern: /"videoBlockId"\s*:/i },
  { label: 'video-block (hyphenated)', pattern: /video-block/i },
  { label: 'a-video-* attributes', pattern: /a-video-(?:url|format|type)/i },
  { label: 'thumbVideo', pattern: /"thumbVideo"\s*:/i },
  { label: 'mainVideo', pattern: /"mainVideo"\s*:/i },
  { label: 'altVideoId', pattern: /"altVideoId"\s*:\s*"/i },
  { label: 'ASMVideoUrl (Amazon Standard Media)', pattern: /"ASMVideoUrl"\s*:/i },
]

const UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
]

export async function GET(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const asin = (searchParams.get('asin') || '').trim().toUpperCase()
  if (!/^[A-Z0-9]{10}$/.test(asin)) {
    return NextResponse.json({ error: 'Invalid ASIN (must be 10 chars A-Z0-9).' }, { status: 400 })
  }

  const desktopUrl = `https://www.amazon.com/dp/${asin}`
  const mobileUrl = `https://www.amazon.com/gp/aw/d/${asin}`
  const t0 = Date.now()

  // Same retry chain as services/amazon.probeCarouselVideo:
  //   1. Desktop / UA[0] / no Referer
  //   2. Desktop / UA[1] / Google Referer  (defeats first-touch block)
  //   3. Mobile  / UA[1] / Google Referer  (different edge)
  // Track which attempt actually returned the real product page.
  const attempts: Array<{ label: string; url: string; ua: string; referer: string | null }> = [
    { label: 'desktop/UA0', url: desktopUrl, ua: UAS[0], referer: null },
    { label: 'desktop/UA1/google', url: desktopUrl, ua: UAS[1], referer: 'https://www.google.com/' },
    { label: 'mobile/UA1/google', url: mobileUrl, ua: UAS[1], referer: 'https://www.google.com/' },
  ]
  const tries: Array<{ label: string; status: number; bytes: number; ms: number; isProduct: boolean }> = []

  let status = 0
  let html = ''
  let fetchErr: string | null = null
  let winningAttempt = ''
  let usedUrl = desktopUrl
  for (const a of attempts) {
    const ta = Date.now()
    try {
      const res = await fetch(a.url, {
        headers: {
          'User-Agent': a.ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': a.referer ? 'cross-site' : 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
          'DNT': '1',
          ...(a.referer ? { Referer: a.referer } : {}),
        },
        signal: AbortSignal.timeout(10_000),
      })
      status = res.status
      const body = await res.text()
      const isProduct = /id="productTitle"|landingImage|imageGalleryData|"hiRes"/i.test(body)
      tries.push({ label: a.label, status: res.status, bytes: body.length, ms: Date.now() - ta, isProduct })
      if (isProduct) {
        html = body
        winningAttempt = a.label
        usedUrl = a.url
        break
      } else if (!html) {
        // Keep the first response we got, in case all attempts fail
        // — at least the user sees one full response in the snippet.
        html = body
        usedUrl = a.url
      }
    } catch (e) {
      tries.push({ label: a.label, status: 0, bytes: 0, ms: Date.now() - ta, isProduct: false })
      if (!fetchErr) fetchErr = e instanceof Error ? e.message : String(e)
    }
  }

  const ms = Date.now() - t0
  const productMarkers = {
    productTitle: /id="productTitle"/i.test(html),
    landingImage: /landingImage/i.test(html),
    imageGalleryData: /imageGalleryData/i.test(html),
    hiRes: /"hiRes"/i.test(html),
  }
  const isProductPage = Object.values(productMarkers).some(Boolean)
  const verdict =
    fetchErr ? 'fetch-failed' :
    !isProductPage ? 'bot-challenge' :
    PATTERNS.some(p => p.pattern.test(html.slice(0, 200_000))) ? 'has-video' :
    'no-video'

  // For each pattern, surface a short snippet AROUND the first match so
  // we can see what context Amazon embeds it in.
  const head = html.slice(0, 200_000)
  const matched: Array<{ label: string; snippet: string }> = []
  const missed: string[] = []
  for (const p of PATTERNS) {
    const m = head.match(p.pattern)
    if (m && m.index != null) {
      const start = Math.max(0, m.index - 60)
      const end = Math.min(head.length, m.index + (m[0]?.length ?? 0) + 60)
      matched.push({ label: p.label, snippet: head.slice(start, end).replace(/\s+/g, ' ') })
    } else {
      missed.push(p.label)
    }
  }

  // Greppable: every URL ending in .mp4 or .m3u8 anywhere in the page.
  // Captures even patterns we don't have explicit rules for.
  // 2026-06-09 v3: scan the WHOLE page now, not just head. For some
  // products the imageBlock JSON island lives later than 200KB.
  const mediaUrls = Array.from(
    html.matchAll(/https?:[^"' >]+\.(?:mp4|m3u8|mov|webm)(?:\?[^"' >]*)?/gi),
  ).map(m => m[0]).slice(0, 10)

  // Every place the literal word "video" appears in the HTML, with a
  // bit of context — first 12 hits. If the product DOES have a video
  // but my patterns are wrong, this will surface the actual structure
  // Amazon embeds (key name, surrounding JSON shape, etc.).
  const videoMentions: Array<{ offset: number; context: string }> = []
  const videoRegex = /video/gi
  for (const m of html.matchAll(videoRegex)) {
    if (videoMentions.length >= 12) break
    if (m.index == null) continue
    const start = Math.max(0, m.index - 80)
    const end = Math.min(html.length, m.index + 100)
    videoMentions.push({
      offset: m.index,
      context: html.slice(start, end).replace(/\s+/g, ' '),
    })
  }

  // Position of common gallery / image-block keys ANYWHERE in the page.
  // Tells us whether the structure lives outside the first 200KB.
  const galleryKeyPositions: Record<string, number> = {}
  for (const key of ['imageBlock', 'imageGalleryData', 'colorImages', 'productImageGallery', 'dpProductImageGallery', 'videoBlock', 'mainVideo']) {
    const idx = html.indexOf(key)
    if (idx >= 0) galleryKeyPositions[key] = idx
  }

  return NextResponse.json({
    asin,
    url: usedUrl,
    attemptChain: tries,
    winningAttempt,
    fetch: { status, ms, ok: !fetchErr, error: fetchErr, html_bytes: html.length },
    isProductPage,
    productMarkers,
    verdict,
    patterns: { matched, missed },
    mediaUrlsFound: mediaUrls,
    videoMentions,
    galleryKeyPositions,
    // First 1000 chars of the imageBlock data island — if present, this
    // is where carousel videos would live. Greppable raw evidence.
    imageBlockExcerpt:
      (head.match(/'imageGalleryData'\s*:\s*\[[\s\S]{0,2000}/)?.[0]
        || head.match(/"imageGalleryData"\s*:\s*\[[\s\S]{0,2000}/)?.[0]
        || head.match(/data-a-state='[^']*imageBlock[^']*'[\s\S]{0,2000}/)?.[0]
        || '(no imageGalleryData / imageBlock data-a-state found)').slice(0, 2000),
  })
}
