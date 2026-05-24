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

export async function overlayCaptionOnVideo(
  sourceVideoUrl: string,
  caption = 'LINK IN BIO',
  opts?: { position?: OverlayPosition; fontSize?: number },
): Promise<OverlaidVideo | null> {
  if (!ensureConfig() || !sourceVideoUrl) return null
  try {
    const { gravity, y } = placement(opts?.position ?? 'lower-third')
    const res = await cloudinary.uploader.upload(sourceVideoUrl, {
      resource_type: 'video',
      folder: 'ig-overlays',
      eager: [{
        overlay: { font_family: 'Arial', font_size: opts?.fontSize ?? 64, font_weight: 'bold', text: caption },
        color: 'white',
        background: '#000000a6', // translucent black pill behind the text
        radius: 20,
        gravity,
        y,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any],
      eager_async: false,
    })
    const url = res.eager?.[0]?.secure_url || res.secure_url
    return url ? { url, publicId: res.public_id } : null
  } catch (e) {
    console.warn('[cloudinary] video overlay failed:', e instanceof Error ? e.message : String(e))
    return null
  }
}

/** Best-effort delete of a Cloudinary video asset (credit cleanup). */
export async function deleteVideoAsset(publicId: string | null | undefined): Promise<void> {
  if (!ensureConfig() || !publicId) return
  try { await cloudinary.uploader.destroy(publicId, { resource_type: 'video' }) } catch { /* non-fatal */ }
}
