// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
/**
 * Cloudinary video text-overlay. Burns a short caption (e.g. "LINK IN BIO")
 * into the LOWER THIRD of a video so it shows on-screen in IG Reels/Stories.
 *
 * Gated on env (CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET). When not
 * configured — or on ANY error — callers fall back to the original video, so
 * this can never break a publish.
 */
import { v2 as cloudinary } from 'cloudinary'
import type { CaptionChunk, SubtitleStyle } from '@/lib/shorts-types'

// Accept EITHER the single CLOUDINARY_URL (cloudinary://key:secret@cloud — the
// format Cloudinary hands you) OR the three discrete vars.
const URL_VAR = process.env.CLOUDINARY_URL
const CLOUD = process.env.CLOUDINARY_CLOUD_NAME
const KEY = process.env.CLOUDINARY_API_KEY
const SECRET = process.env.CLOUDINARY_API_SECRET

let configured = false
function ensureConfig(): boolean {
  if (configured) return true
  if (CLOUD && KEY && SECRET) {
    cloudinary.config({ cloud_name: CLOUD, api_key: KEY, api_secret: SECRET, secure: true })
    configured = true
    return true
  }
  if (URL_VAR) {
    // The SDK parses CLOUDINARY_URL from the environment automatically.
    cloudinary.config({ secure: true })
    configured = true
    return true
  }
  return false
}

export function cloudinaryConfigured(): boolean {
  return !!((CLOUD && KEY && SECRET) || URL_VAR)
}

/** Diagnostic: verify the configured credentials actually work + report which
 *  cloud is loaded, so we can confirm the env var is live and correct. */
export async function cloudinaryPing(): Promise<{ ok: boolean; cloudName?: string; error?: string }> {
  if (!ensureConfig()) return { ok: false, error: 'Not configured — set CLOUDINARY_URL (or the 3 discrete vars).' }
  try {
    await cloudinary.api.ping()
    return { ok: true, cloudName: (cloudinary.config().cloud_name as string) || undefined }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Text overlays render in Arial (a Cloudinary built-in), so keep CTA/headline
// ASCII — emoji and fancy punctuation don't render in that font.
const asciiSafe = (s: string) => (s || '').replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim()

// The "LINK IN BIO" sticker, drawn as one SVG (white rounded pill + a real
// chain-link icon + bold label) so it looks exactly like Instagram's native
// link sticker. Uploaded once to Cloudinary and reused as an image overlay; if
// the upload/rasterization ever fails, renderStoryImage falls back to a plain
// text pill. Cached per process.
const LINK_STICKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="150" viewBox="0 0 520 150">
<rect x="5" y="5" width="510" height="140" rx="36" fill="#ffffff"/>
<g transform="translate(40,45) scale(2.6)" fill="none" stroke="#111114" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" x2="16" y1="12" y2="12"/>
</g>
<text x="138" y="97" font-family="Arial, Helvetica, sans-serif" font-size="50" font-weight="700" letter-spacing="2" fill="#111114">LINK IN BIO</text>
</svg>`
let _stickerId: string | null | undefined
async function ensureLinkSticker(): Promise<string | null> {
  if (_stickerId !== undefined) return _stickerId
  try {
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(LINK_STICKER_SVG).toString('base64')}`
    const up = await cloudinary.uploader.upload(dataUri, { public_id: 'deal-stories/link-sticker', overwrite: true, resource_type: 'image' })
    _stickerId = up.public_id as string
  } catch { _stickerId = null }
  return _stickerId
}

/**
 * Compose a 1080×1920 (9:16) Instagram Story image from a product image: the
 * creator's logo + handle up top, an optional deal headline, the product framed
 * on a dark canvas, and an Instagram-style "LINK IN BIO" sticker in the lower
 * third — all baked in, because Stories published via the API can't carry a
 * caption or a tappable link sticker (Meta doesn't allow it). Returns a
 * ready-to-publish JPEG URL, or null if Cloudinary isn't configured / anything
 * fails (caller decides).
 */
// Cloudinary text overlays can't contain %, comma, or slash (they're layer
// delimiters and under-encode). Strip them so a headline never breaks the URL.
const overlayText = (s?: string) => asciiSafe(s || '').replace(/[%,/\\]/g, ' ').replace(/\s+/g, ' ').trim()

/** GET the URL and confirm Cloudinary actually served an image (not a 400/error
 *  page) — so we never hand Instagram a broken URL ("Only photo or video can be
 *  accepted as media type"). */
async function urlIsImage(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'GET' })
    return res.ok && (res.headers.get('content-type') || '').startsWith('image/')
  } catch { return false }
}

/**
 * A JPG poster frame for ANY remote video URL, via Cloudinary remote fetch.
 * Pinterest video pins REQUIRE a cover image; a clip rendered off-Cloudinary
 * (the ingest engine returns an external .mp4) has no native Cloudinary frame to
 * derive, which used to make the pin fail. Cloudinary can fetch a remote video
 * and hand back a frame, so this covers any host. Returns null when Cloudinary
 * isn't configured or can't produce a valid image.
 */
export async function remoteVideoPosterUrl(videoUrl: string): Promise<string | null> {
  if (!ensureConfig()) return null
  if (!/^https:\/\//i.test(videoUrl)) return null
  try {
    const url = cloudinary.url(videoUrl, {
      resource_type: 'video',
      type: 'fetch',
      format: 'jpg',
      secure: true,
      transformation: [{ start_offset: '0', width: 720, crop: 'fill' }],
    })
    return (await urlIsImage(url)) ? url : null
  } catch { return null }
}

export async function renderStoryImage(
  productImageUrl: string,
  opts: { headline?: string; handle?: string; logoUrl?: string } = {},
): Promise<string | null> {
  if (!ensureConfig()) return null
  if (!productImageUrl || !/^https?:\/\//i.test(productImageUrl)) return null
  try {
    const up = await cloudinary.uploader.upload(productImageUrl, {
      folder: 'deal-stories', resource_type: 'image', overwrite: false,
    })
    const publicId = up.public_id as string
    const headline = overlayText(opts.headline).toUpperCase().slice(0, 40)
    const handle = overlayText(opts.handle).slice(0, 30)

    // Brand logo — best-effort. FLAT folder so the overlay ref is a single
    // `folder:name` (a nested folder produced a broken `l_a:b/c` layer that
    // failed the whole render).
    let logoId: string | null = null
    if (opts.logoUrl && /^https?:\/\//i.test(opts.logoUrl)) {
      try {
        const l = await cloudinary.uploader.upload(opts.logoUrl, { folder: 'deal-stories', resource_type: 'image', overwrite: false })
        logoId = l.public_id as string
      } catch { /* no logo this time */ }
    }
    const stickerId = await ensureLinkSticker()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base: any[] = [
      { width: 960, height: 1120, crop: 'pad', background: 'white' },
      { width: 1080, height: 1920, crop: 'pad', background: '#0e0e11', gravity: 'center' },
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headlineLayer = (y: number): any[] => headline ? [{ overlay: { font_family: 'Arial', font_size: 54, font_weight: 'bold', text: headline }, color: '#ffffff', background: '#7C3AED', gravity: 'north', y, radius: 12 }] : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleLayer = (y: number): any[] => handle ? [{ overlay: { font_family: 'Arial', font_size: 40, font_weight: 'bold', text: handle }, color: '#ffffff', gravity: 'north', y }] : []
    const textPill = { overlay: { font_family: 'Arial', font_size: 48, font_weight: 'bold', letter_spacing: 2, text: 'LINK IN BIO' }, color: '#111114', background: '#ffffff', radius: 30, gravity: 'south', y: 300, angle: -5 }

    // RICH: logo + handle + headline + SVG link sticker.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rich: any[] = [...base]
    if (logoId) rich.push({ overlay: { public_id: logoId }, width: 104, height: 104, crop: 'thumb', radius: 'max', gravity: 'north', y: 80 })
    rich.push(...handleLayer(logoId ? 205 : 96))
    rich.push(...headlineLayer(logoId ? 270 : (handle ? 150 : 96)))
    rich.push(stickerId ? { overlay: { public_id: stickerId }, width: 520, gravity: 'south', y: 300, angle: -5 } : textPill)
    const richUrl = cloudinary.url(publicId, { transformation: rich, secure: true, format: 'jpg' })
    if (await urlIsImage(richUrl)) return richUrl

    // SIMPLE fallback: text-only overlays (no logo/SVG) — maximally reliable.
    const simple = [...base, ...handleLayer(96), ...headlineLayer(handle ? 152 : 96), textPill]
    const simpleUrl = cloudinary.url(publicId, { transformation: simple, secure: true, format: 'jpg' })
    if (await urlIsImage(simpleUrl)) return simpleUrl

    lastOverlayError = 'Cloudinary did not return a valid story image'
    return null
  } catch (e) {
    lastOverlayError = e instanceof Error ? e.message : String(e)
    return null
  }
}

/**
 * Compose a 1080×1080 square DEAL CARD from a product image: the product padded
 * on a dark canvas, a bold deal-hook banner at the top (e.g. "HOT DEAL",
 * "LOWEST PRICE"), an optional supporting line under it, and an optional brand
 * chip. Used by the Deal Radar / Walmart / Wayward "Quick post to socials" so
 * the image on Facebook / Threads / LinkedIn / Telegram / Bluesky reads as a
 * designed offer, not a bare product photo.
 *
 * Square (1080×1080) so ONE render works everywhere those platforms show it.
 * Headlines are QUALITATIVE on purpose — never a specific % or price — because
 * the post is evergreen and the number changes (same rule as the deal caption).
 *
 * Returns a ready-to-post JPEG URL, or null if Cloudinary isn't configured /
 * anything fails (caller falls back to the raw product photo).
 */
export async function renderDealCard(
  productImageUrl: string,
  opts: { headline?: string; subline?: string; brandName?: string; logoUrl?: string } = {},
): Promise<string | null> {
  if (!ensureConfig()) return null
  if (!productImageUrl || !/^https?:\/\//i.test(productImageUrl)) return null
  try {
    const up = await cloudinary.uploader.upload(productImageUrl, {
      folder: 'deal-cards', resource_type: 'image', overwrite: false,
    })
    const publicId = up.public_id as string
    const headline = overlayText(opts.headline).toUpperCase().slice(0, 22)
    const subline = overlayText(opts.subline).slice(0, 40)
    const brand = overlayText(opts.brandName).slice(0, 28)

    // Brand logo — best-effort, FLAT folder (nested ids break the overlay ref).
    let logoId: string | null = null
    if (opts.logoUrl && /^https?:\/\//i.test(opts.logoUrl)) {
      try {
        const l = await cloudinary.uploader.upload(opts.logoUrl, { folder: 'deal-cards', resource_type: 'image', overwrite: false })
        logoId = l.public_id as string
      } catch { /* no logo this time */ }
    }

    // Product padded to a square on white, then the square framed on dark.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base: any[] = [
      { width: 940, height: 940, crop: 'pad', background: 'white' },
      { width: 1080, height: 1080, crop: 'pad', background: '#0e0e11', gravity: 'center' },
    ]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const headlineLayer = (y: number): any[] => headline
      ? [{ overlay: { font_family: 'Arial', font_size: 72, font_weight: 'bold', letter_spacing: 2, text: headline }, color: '#ffffff', background: '#7C3AED', gravity: 'north', y, radius: 14 }]
      : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sublineLayer = (y: number): any[] => subline
      ? [{ overlay: { font_family: 'Arial', font_size: 38, font_weight: 'bold', text: subline }, color: '#111114', background: '#ffffff', gravity: 'north', y, radius: 10 }]
      : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const brandLayer = (y: number): any[] => brand
      ? [{ overlay: { font_family: 'Arial', font_size: 34, font_weight: 'bold', text: brand }, color: '#ffffff', background: '#111114', gravity: 'south', y, radius: 20 }]
      : []

    // RICH: logo + headline + subline + brand chip.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rich: any[] = [...base]
    if (logoId) rich.push({ overlay: { public_id: logoId }, width: 92, height: 92, crop: 'thumb', radius: 'max', gravity: 'north_west', x: 44, y: 44 })
    rich.push(...headlineLayer(56))
    rich.push(...sublineLayer(148))
    rich.push(...brandLayer(48))
    const richUrl = cloudinary.url(publicId, { transformation: rich, secure: true, format: 'jpg' })
    if (await urlIsImage(richUrl)) return richUrl

    // SIMPLE fallback: text-only overlays (no logo) — maximally reliable.
    const simple = [...base, ...headlineLayer(56), ...sublineLayer(148), ...brandLayer(48)]
    const simpleUrl = cloudinary.url(publicId, { transformation: simple, secure: true, format: 'jpg' })
    if (await urlIsImage(simpleUrl)) return simpleUrl

    lastOverlayError = 'Cloudinary did not return a valid deal card'
    return null
  } catch (e) {
    lastOverlayError = e instanceof Error ? e.message : String(e)
    return null
  }
}

export interface OverlaidVideo { url: string; publicId: string }

/**
 * Upload `sourceVideoUrl` to Cloudinary, normalize to 1080×1920, and return a
 * delivery URL with the caption burned in at the chosen position/style. We poll
 * the derived URL until Cloudinary finishes rendering (it serves 423 while
 * processing) so the returned URL is render-ready before we hand it to the user
 * or Instagram. Returns null when Cloudinary isn't configured or anything fails
 * (callers fall back to the original video); the reason is in getLastOverlayError().
 */
export type OverlayPosition = 'lower-third' | 'bottom' | 'center' | 'top' | 'lower-left' | 'lower-right' | 'upper-left' | 'upper-right'
export type CaptionStyle = 'white-pill' | 'black-pill' | 'yellow-pill' | 'white-shadow'

/** Visual look for the burned caption. */
function styleParams(style: CaptionStyle): { color: string; background?: string; radius?: number; effect?: string } {
  // Opaque hex6 backgrounds — Cloudinary rejects 8-digit (alpha) hex in the
  // delivery URL, which 400s the whole transform.
  switch (style) {
    case 'black-pill': return { color: 'black', background: '#ffffff', radius: 24 }
    case 'yellow-pill': return { color: '#ffd400', background: '#111111', radius: 20 }
    case 'white-shadow': return { color: 'white', effect: 'shadow:50' }
    case 'white-pill':
    default: return { color: 'white', background: '#111111', radius: 20 }
  }
}

/** Map a friendly position to Cloudinary gravity + pixel x/y offsets (tuned for
 *  a 1080×1920 vertical video). lower-third sits clear of IG's bottom UI; the
 *  corner positions tuck in from the edge, clear of TikTok/IG's right-side
 *  action buttons (lower-left) and bottom caption strip. */
function placement(pos: OverlayPosition): { gravity: string; x: number; y: number } {
  switch (pos) {
    case 'bottom': return { gravity: 'south', x: 0, y: 130 }
    case 'center': return { gravity: 'center', x: 0, y: 0 }
    case 'top': return { gravity: 'north', x: 0, y: 220 }
    // Tuck into the very bottom corner, BELOW the running-caption band (Shorts
    // render burns captions centered at y≈430), so a CTA box never covers the
    // subtitles. Also pulled tighter to the edge (x:40).
    case 'lower-left': return { gravity: 'south_west', x: 40, y: 150 }
    case 'lower-right': return { gravity: 'south_east', x: 40, y: 150 }
    case 'upper-left': return { gravity: 'north_west', x: 60, y: 240 }
    case 'upper-right': return { gravity: 'north_east', x: 60, y: 240 }
    case 'lower-third':
    default: return { gravity: 'south', x: 0, y: 360 }
  }
}

/** Last failure reason from overlayCaptionOnVideo — surfaced by the burn route
 *  so we can see the real Cloudinary error instead of a generic message. */
let lastOverlayError: string | null = null
export function getLastOverlayError(): string | null { return lastOverlayError }

/** Poll a Cloudinary derived-video URL until it serves real bytes. Cloudinary
 *  renders video derivations on first request and returns 423 while processing,
 *  then 200/206 once ready. A 4xx means the transformation is invalid (won't
 *  fix itself) — bail early with the body. Returns ready + a detail string. */
async function waitForVideo(url: string, timeoutMs: number): Promise<{ ready: boolean; detail: string }> {
  const start = Date.now()
  let last = 'no response'
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-1' } })
      if (res.status === 200 || res.status === 206) {
        const len = res.headers.get('content-length')
        if (!len || parseInt(len, 10) > 0) return { ready: true, detail: 'ok' }
        last = `200 but empty (content-length=${len})`
      } else if (res.status === 423 || res.status === 420) {
        last = `processing (${res.status})`
      } else {
        const body = await res.text().catch(() => '')
        // Cloudinary puts the real transform error in the x-cld-error header.
        const cldErr = res.headers.get('x-cld-error') || ''
        last = `HTTP ${res.status}: ${(cldErr || body).slice(0, 260)}`
        if (res.status >= 400 && res.status < 500) return { ready: false, detail: last } // invalid transform — stop
      }
    } catch (e) {
      last = `fetch error: ${e instanceof Error ? e.message : String(e)}`
    }
    await new Promise(r => setTimeout(r, 3000))
  }
  return { ready: false, detail: `timeout after ${Math.round(timeoutMs / 1000)}s — last: ${last}` }
}

export async function overlayCaptionOnVideo(
  sourceVideoUrl: string,
  caption = 'LINK IN BIO',
  opts?: {
    position?: OverlayPosition
    fontSize?: number
    style?: CaptionStyle
    /** When set, burn this PNG (a CTA box from public/cta-burner/) onto the
     *  video INSTEAD of the text caption. Must be an absolute, public URL —
     *  Cloudinary fetches it via l_fetch and overlays it. */
    stickerUrl?: string
    /** Sticker width as a fraction of video width (0–1, default 0.85). */
    stickerWidthPct?: number
    /** Free placement: the overlay's TOP-LEFT as a fraction of the 1080×1920
     *  frame (0–1). When set, it wins over `position` and the width is used
     *  as-is (no extra down-scale) so the burn matches the drag preview. */
    placement?: { xPct: number; yPct: number }
    /** How long (seconds from the start) the overlay stays on screen. Omit / 0
     *  → the whole video. Cloudinary time-boxes the overlay via so_0,eo_<n>. */
    stickerDurationSec?: number
  },
): Promise<OverlaidVideo | null> {
  if (!ensureConfig() || !sourceVideoUrl) return null
  lastOverlayError = null
  try {
    const { gravity, x, y } = placement(opts?.position ?? 'lower-third')
    const sp = styleParams(opts?.style ?? 'white-pill')
    // Time-box the overlay: when a positive duration is given, the CTA shows
    // from 0s to <n>s then disappears; otherwise it rides the whole clip.
    const dur = Number(opts?.stickerDurationSec)
    const timing = Number.isFinite(dur) && dur > 0
      ? { start_offset: 0, end_offset: Math.round(dur * 10) / 10 }
      : {}
    // Cloudinary's Arial text layer can't render emoji / non-ASCII and 400s the
    // transform — strip to plain text for the burned caption.
    const safeCaption = (caption.replace(/[^\x20-\x7E]/g, '').replace(/\s{2,}/g, ' ').trim()) || 'LINK IN BIO'

    // 1. Upload the source video (no transform yet).
    const up = await cloudinary.uploader.upload(sourceVideoUrl, {
      resource_type: 'video',
      folder: 'ig-overlays',
    })
    const publicId = up.public_id

    // The overlay layer: a fetched PNG (CTA sticker) when stickerUrl is given,
    // else the styled text caption. Cloudinary needs the remote URL passed as
    // `{ overlay: { url } }`, which it encodes to l_fetch:<base64url>.
    // Free placement (drag preview) → anchor the overlay's top-left at the given
    // fraction of the 1080×1920 frame; the client already sized the badge, so use
    // its width as-is. Otherwise fall back to the preset gravity + the 0.75
    // "badge, not banner" down-scale.
    const free = opts?.placement
    const overlayLayer = opts?.stickerUrl
      ? {
          overlay: { url: opts.stickerUrl },
          width: (opts?.stickerWidthPct ?? 0.85) * (free ? 1 : 0.75),
          crop: 'scale',
          flags: 'relative', // size relative to the base video width
          ...(free
            ? { gravity: 'north_west', x: Math.round(Math.min(1, Math.max(0, free.xPct)) * 1080), y: Math.round(Math.min(1, Math.max(0, free.yPct)) * 1920) }
            : { gravity, ...(x ? { x } : {}), y }),
          ...timing,
        }
      : {
          overlay: { font_family: 'Arial', font_size: opts?.fontSize ?? 64, font_weight: 'bold', text: safeCaption },
          color: sp.color,
          ...(sp.background ? { background: sp.background, radius: sp.radius ?? 20 } : {}),
          ...(sp.effect ? { effect: sp.effect } : {}),
          gravity,
          ...(x ? { x } : {}),
          y,
          ...timing,
        }

    // 2. Build the derived URL: normalize to the IG Reel spec (1080×1920, 9:16,
    //    center-crop + scale, h264 mp4), then burn the overlay (sticker or text).
    const url = cloudinary.url(publicId, {
      resource_type: 'video',
      secure: true,
      format: 'mp4',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transformation: [
        // quality:auto:best + a 6 Mbps target give Instagram a crisp, high-bitrate
        // Reel to re-encode from. Without them Cloudinary picks a conservative
        // default bitrate, and after IG's own re-compression that reads as soft.
        { width: 1080, height: 1920, crop: 'fill', gravity: 'center', video_codec: 'h264', quality: 'auto:best', bit_rate: '6m' },
        overlayLayer,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    })

    // 3. Cloudinary renders video derivations lazily and returns 423 while
    //    processing. Poll until it actually serves bytes so we never hand back
    //    a not-ready (0-byte) URL to the user or Instagram.
    const { ready, detail } = await waitForVideo(url, 120_000)
    if (!ready) {
      lastOverlayError = detail
      console.warn('[cloudinary] derived video not ready:', detail, '| url:', url)
      return null
    }
    return { url, publicId }
  } catch (e) {
    lastOverlayError = e instanceof Error ? e.message : String(e)
    console.warn('[cloudinary] video overlay failed:', lastOverlayError)
    return null
  }
}

/** Best-effort delete of a Cloudinary video asset (credit cleanup). */
export async function deleteVideoAsset(publicId: string | null | undefined): Promise<void> {
  if (!ensureConfig() || !publicId) return
  try { await cloudinary.uploader.destroy(publicId, { resource_type: 'video' }) } catch { /* non-fatal */ }
}

// ── Shorts Studio: chop a long video into a captioned vertical Short ──────────

/** Pull a human message out of any thrown value. Cloudinary rejects with plain
 *  objects ({ message }, { error: { message } }, { http_code }), not Error
 *  instances — String(e) on those yields the useless "[object Object]". */
function errMessage(e: unknown): string {
  if (!e) return 'unknown error'
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (typeof e === 'object') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = e as any
    if (o.message) return String(o.message)
    if (o.error?.message) return String(o.error.message)
    if (typeof o.error === 'string') return o.error
    if (o.http_code) return `Cloudinary HTTP ${o.http_code}${o.name ? ` (${o.name})` : ''}`
    try { return JSON.stringify(o).slice(0, 300) } catch { /* fall through */ }
  }
  return String(e)
}

/** Last failure reason from renderVerticalShort — surfaced by the render route
 *  so the creator sees the real Cloudinary error, not a generic message. */
let lastShortError: string | null = null
export function getLastShortError(): string | null { return lastShortError }

/** Per-caption visual params. Burned as time-boxed Arial-bold text layers so the
 *  words track the audio. Boxed/pop styles use a pill background (proven legible
 *  in the IG burner); bold-white leans on a drop shadow. */
interface SubtitleLook {
  color: string
  background?: string
  radius?: number
  effect?: string
  /** Text stroke, e.g. '5px_solid_black' — a readable outline with no box. */
  border?: string
  fontFamily?: string
  fontWeight?: string
  fontSize?: number
  /** Render the line UPPERCASE (punchy "hype" look). */
  upper?: boolean
}

function subtitleParams(style: SubtitleStyle): SubtitleLook {
  switch (style) {
    case 'yellow-pop': return { color: '#ffd400', background: '#111111', radius: 18 }
    // Clean white text with a thick black outline, no box — the most legible
    // "Creator Cut" look over any footage.
    case 'outline': return { color: 'white', border: '8px_solid_black', fontWeight: 'bold' }
    // Big UPPERCASE yellow with a heavy black outline — high-energy, still very
    // readable (Arial, not Impact — Impact rendered small/muddy).
    case 'hype': return { color: '#ffd400', border: '10px_solid_black', fontWeight: 'bold', upper: true, fontSize: 104 }
    // White text on a brand-violet pill.
    case 'brand': return { color: 'white', background: '#7C3AED', radius: 22 }
    case 'bold-white':
    default: return { color: 'white', effect: 'shadow:60' }
  }
}

/** Cloudinary's Arial layer 400s on emoji / non-ASCII — strip to plain text
 *  (mirrors overlayCaptionOnVideo). Also upper-caps runaway length. */
function safeLayerText(s: string, max = 90): string {
  return (s || '').replace(/[^\x20-\x7E]/g, '').replace(/\s{2,}/g, ' ').trim().slice(0, max)
}

export interface RenderShortOpts {
  /** Public (https) URL of the SOURCE long-form video — the creator-uploaded MP4. */
  sourceVideoUrl: string
  /** Clip window on the SOURCE timeline, in seconds. */
  startSec: number
  endSec: number
  /** Clip-RELATIVE caption timeline (0 = clip start) from lib/shorts-captions. */
  captions: CaptionChunk[]
  style?: SubtitleStyle
  /** Optional persistent title burned along the top of the whole clip. */
  hook?: string
  /** Reuse a previously-uploaded Cloudinary source asset (public id) so
   *  rendering N clips from one video only uploads the big file once. When
   *  omitted, we upload the source and return its id for the caller to cache. */
  sourcePublicId?: string | null
}

export interface RenderShortResult {
  /** Render-ready delivery URL of the finished vertical Short. */
  url: string
  /** Public id of the DERIVED source asset (for cache reuse + cleanup). */
  sourcePublicId: string
}

/**
 * Trim [startSec, endSec] out of the source, reframe it to a 1080×1920 vertical
 * (content-aware crop), and burn the caption timeline in — one time-boxed text
 * layer per chunk, plus an optional persistent hook title. Because the trim is
 * the FIRST transform component, the clip is re-based to 0, so the caption
 * start/end offsets (already clip-relative) line up with the words.
 *
 * Returns null on any failure (reason in getLastShortError()) so the route can
 * report it without the render ever throwing.
 */
export async function renderVerticalShort(opts: RenderShortOpts): Promise<RenderShortResult | null> {
  lastShortError = null
  if (!ensureConfig()) { lastShortError = 'Cloudinary not configured.'; return null }
  const { sourceVideoUrl, startSec, endSec } = opts
  if (!sourceVideoUrl || !(endSec > startSec)) { lastShortError = 'Invalid clip window.'; return null }

  try {
    // 1. Reuse the cached source asset, or upload it once (Cloudinary fetches
    //    the Supabase-hosted URL server-side).
    let sourcePublicId = (opts.sourcePublicId || '').trim()
    if (!sourcePublicId) {
      const up = await cloudinary.uploader.upload(sourceVideoUrl, { resource_type: 'video', folder: 'shorts-src' })
      sourcePublicId = up.public_id
    }

    const dur = Math.round((endSec - startSec) * 10) / 10
    const sp = subtitleParams(opts.style ?? 'bold-white')

    // 2a. Trim + reframe to 9:16. gravity 'auto' keeps the subject in frame when
    //     cropping a horizontal source down to vertical.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transformation: any[] = [
      {
        start_offset: Math.round(startSec * 10) / 10,
        end_offset: Math.round(endSec * 10) / 10,
        // gravity 'center' (not 'auto' — Cloudinary can 400 on g_auto video crop).
        // quality:auto:best + a 6 Mbps target keep the clip crisp through IG's
        // re-encode; without them Cloudinary's default bitrate reads soft.
        width: 1080, height: 1920, crop: 'fill', gravity: 'center', video_codec: 'h264',
        quality: 'auto:best', bit_rate: '6m',
      },
    ]

    // 2b. Optional persistent hook title along the top.
    const hook = safeLayerText(opts.hook || '', 60)
    if (hook) {
      transformation.push({
        overlay: { font_family: 'Arial', font_size: 58, font_weight: 'bold', text: hook },
        color: 'white', background: '#000000', radius: 16,
        width: 940, crop: 'fit', gravity: 'north', y: 150,
      })
    }

    // 2c. One time-boxed caption layer per chunk. Clip-relative so_/eo_ track the
    //     spoken words; capped defensively so the delivery URL stays bounded.
    for (const c of (opts.captions || []).slice(0, 40)) {
      const text = safeLayerText(sp.upper ? c.text.toUpperCase() : c.text)
      if (!text) continue
      const so = Math.max(0, Math.min(dur, Math.round(c.startSec * 10) / 10))
      const eo = Math.max(so + 0.2, Math.min(dur, Math.round(c.endSec * 10) / 10))
      transformation.push({
        // Big by default (word-level lines are only 2–3 words, so a small font
        // looks lost). Short lines stay at this size; long ones scale down to fit.
        overlay: { font_family: sp.fontFamily ?? 'Arial', font_size: sp.fontSize ?? 92, font_weight: sp.fontWeight ?? 'bold', text },
        color: sp.color,
        ...(sp.background ? { background: sp.background, radius: sp.radius ?? 18 } : {}),
        ...(sp.effect ? { effect: sp.effect } : {}),
        ...(sp.border ? { border: sp.border } : {}),
        width: 960, crop: 'fit',
        // Sit the running captions a little higher so they clear the bottom-corner
        // CTA box (which sits at y≈150) with clean space between them.
        gravity: 'south', y: 520,
        start_offset: so, end_offset: eo,
      })
    }

    const url = cloudinary.url(sourcePublicId, {
      resource_type: 'video', secure: true, format: 'mp4',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transformation: transformation as any,
    })

    // 3. Cloudinary renders derivations lazily (423 while processing) — poll
    //    until it serves real bytes. A trimmed+captioned clip is fast to render.
    const { ready, detail } = await waitForVideo(url, 180_000)
    if (!ready) { lastShortError = detail; console.warn('[cloudinary] short not ready:', detail, '| url:', url); return null }
    return { url, sourcePublicId }
  } catch (e) {
    lastShortError = errMessage(e)
    console.warn('[cloudinary] renderVerticalShort failed:', lastShortError)
    return null
  }
}
