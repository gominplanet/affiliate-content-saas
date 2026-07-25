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
    case 'lower-left': return { gravity: 'south_west', x: 60, y: 320 }
    case 'lower-right': return { gravity: 'south_east', x: 60, y: 320 }
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
    const overlayLayer = opts?.stickerUrl
      ? {
          overlay: { url: opts.stickerUrl },
          // Global 0.75 down-scale — every CTA box burns at 75% of its nominal
          // width so it sits as a badge, not a banner across the frame.
          width: (opts?.stickerWidthPct ?? 0.85) * 0.75,
          crop: 'scale',
          flags: 'relative', // size relative to the base video width
          gravity,
          ...(x ? { x } : {}),
          y,
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
        { width: 1080, height: 1920, crop: 'fill', gravity: 'center', video_codec: 'h264' },
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
function subtitleParams(style: SubtitleStyle): { color: string; background?: string; radius?: number; effect?: string } {
  switch (style) {
    case 'yellow-pop': return { color: '#ffd400', background: '#111111', radius: 18 }
    case 'boxed': return { color: 'white', background: '#111111', radius: 18 }
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
        width: 1080, height: 1920, crop: 'fill', gravity: 'center', video_codec: 'h264',
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
      const text = safeLayerText(c.text)
      if (!text) continue
      const so = Math.max(0, Math.min(dur, Math.round(c.startSec * 10) / 10))
      const eo = Math.max(so + 0.2, Math.min(dur, Math.round(c.endSec * 10) / 10))
      transformation.push({
        overlay: { font_family: 'Arial', font_size: 62, font_weight: 'bold', text },
        color: sp.color,
        ...(sp.background ? { background: sp.background, radius: sp.radius ?? 18 } : {}),
        ...(sp.effect ? { effect: sp.effect } : {}),
        width: 920, crop: 'fit',
        gravity: 'south', y: 430,
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
