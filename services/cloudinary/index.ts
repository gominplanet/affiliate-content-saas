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

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME
const KEY = process.env.CLOUDINARY_API_KEY
const SECRET = process.env.CLOUDINARY_API_SECRET

let configured = false
function ensureConfig(): boolean {
  if (!CLOUD || !KEY || !SECRET) return false
  if (!configured) {
    cloudinary.config({ cloud_name: CLOUD, api_key: KEY, api_secret: SECRET, secure: true })
    configured = true
  }
  return true
}

export function cloudinaryConfigured(): boolean {
  return !!(CLOUD && KEY && SECRET)
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
export async function overlayCaptionOnVideo(
  sourceVideoUrl: string,
  caption = 'LINK IN BIO',
): Promise<OverlaidVideo | null> {
  if (!ensureConfig() || !sourceVideoUrl) return null
  try {
    const res = await cloudinary.uploader.upload(sourceVideoUrl, {
      resource_type: 'video',
      folder: 'ig-overlays',
      eager: [{
        overlay: { font_family: 'Arial', font_size: 64, font_weight: 'bold', text: caption },
        color: 'white',
        background: '#000000a6', // translucent black pill behind the text
        radius: 20,
        gravity: 'south',
        y: 360, // ~lower third, clear of IG's bottom UI
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
