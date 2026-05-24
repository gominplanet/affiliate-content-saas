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
 * Upload `sourceVideoUrl` to Cloudinary and return a delivery URL with the
 * caption burned into the lower third (~75% down, centred) on a translucent
 * rounded pill for legibility. `y: 360` lifts it clear of Instagram's own
 * caption/buttons UI at the very bottom of a Reel. Returns null when Cloudinary
 * isn't configured or anything fails (caller uses the original video).
 *
 * Uses a synchronous eager transformation so the returned URL is render-ready
 * before we hand it to Instagram.
 */
export type OverlayPosition = 'lower-third' | 'bottom' | 'center' | 'top'
export type CaptionStyle = 'white-pill' | 'black-pill' | 'yellow-pill' | 'white-shadow'

/** Visual look for the burned caption. */
function styleParams(style: CaptionStyle): { color: string; background?: string; radius?: number; effect?: string } {
  switch (style) {
    case 'black-pill': return { color: 'black', background: '#ffffffd9', radius: 24 }
    case 'yellow-pill': return { color: '#FFD400', background: '#000000a6', radius: 20 }
    case 'white-shadow': return { color: 'white', effect: 'shadow:60' }
    case 'white-pill':
    default: return { color: 'white', background: '#000000a6', radius: 20 }
  }
}

/** Map a friendly position to Cloudinary gravity + pixel y-offset (tuned for
 *  a 1080×1920 vertical video). lower-third sits clear of IG's bottom UI. */
function placement(pos: OverlayPosition): { gravity: string; y: number } {
  switch (pos) {
    case 'bottom': return { gravity: 'south', y: 130 }
    case 'center': return { gravity: 'center', y: 0 }
    case 'top': return { gravity: 'north', y: 220 }
    case 'lower-third':
    default: return { gravity: 'south', y: 360 }
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
        last = `HTTP ${res.status}: ${body.slice(0, 220)}`
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
  opts?: { position?: OverlayPosition; fontSize?: number; style?: CaptionStyle },
): Promise<OverlaidVideo | null> {
  if (!ensureConfig() || !sourceVideoUrl) return null
  lastOverlayError = null
  try {
    const { gravity, y } = placement(opts?.position ?? 'lower-third')
    const sp = styleParams(opts?.style ?? 'white-pill')

    // 1. Upload the source video (no transform yet).
    const up = await cloudinary.uploader.upload(sourceVideoUrl, {
      resource_type: 'video',
      folder: 'ig-overlays',
    })
    const publicId = up.public_id

    // 2. Build the derived URL: normalize to the IG Reel spec (1080×1920, 9:16,
    //    center-crop + scale, h264 mp4), then burn the caption.
    const url = cloudinary.url(publicId, {
      resource_type: 'video',
      secure: true,
      format: 'mp4',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      transformation: [
        { width: 1080, height: 1920, crop: 'fill', gravity: 'center', video_codec: 'h264' },
        {
          overlay: { font_family: 'Arial', font_size: opts?.fontSize ?? 64, font_weight: 'bold', text: caption },
          color: sp.color,
          ...(sp.background ? { background: sp.background, radius: sp.radius ?? 20 } : {}),
          ...(sp.effect ? { effect: sp.effect } : {}),
          gravity,
          y,
        },
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
