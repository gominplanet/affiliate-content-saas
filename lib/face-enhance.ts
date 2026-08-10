// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Light, identity-preserving face retouch for the "optimize my selfies" feature.
//
// We use CodeFormer (a face-RESTORATION model, not a generative redraw): it
// cleans up lighting, sharpness and skin on a real portrait WITHOUT inventing a
// new face, so the person stays exactly themselves. `fidelity` high = stay close
// to the original (a light touch, never an aggressive glow-up), which is the
// explicit product requirement.
//
// Everything fails soft: on any error the caller keeps the original photo.
import { fal } from '@fal-ai/client'

export const FACE_ENHANCE_MODEL = 'fal-ai/codeformer'

/** Pull a result image URL out of the various shapes fal endpoints return. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickUrl(r: any): string | null {
  const u =
    r?.data?.image?.url ??
    r?.image?.url ??
    r?.data?.images?.[0]?.url ??
    r?.images?.[0]?.url ??
    null
  return typeof u === 'string' ? u : null
}

/**
 * Enhance a single portrait. `imageUrl` must be a public URL CodeFormer can
 * fetch (upload to fal.storage first for private/storage images). Returns the
 * enhanced image URL, or null on any failure (caller keeps the original).
 */
export async function enhanceFaceImage(imageUrl: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fal.subscribe(FACE_ENHANCE_MODEL as any, {
      input: {
        image_url: imageUrl,
        // High fidelity = keep the person's real features (light retouch, not a
        // redraw). 0.7–0.9 is the "preserve identity" band for CodeFormer.
        fidelity: 0.8,
        upscaling: 2,
        face_upsample: true,
      },
      logs: false,
    })
    return pickUrl(result)
  } catch {
    return null
  }
}
