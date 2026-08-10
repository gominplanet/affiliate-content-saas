// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Light, identity-preserving face retouch for the "optimize my selfies" feature.
//
// We use CodeFormer (a face-RESTORATION model, not a generative redraw): it
// cleans up lighting, sharpness and skin on a real portrait WITHOUT inventing a
// new face, so the person stays exactly themselves. `fidelity` high = stay close
// to the original (a light touch, never an aggressive glow-up).
//
// Returns the enhanced URL AND the error string (when it fails) so the caller
// can surface WHY a photo couldn't be optimized instead of silently dropping it.
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

export interface EnhanceResult { url: string | null; error: string | null }

/**
 * Enhance a single portrait. `imageUrl` must be a public URL CodeFormer can
 * fetch. Retries once on failure. Returns { url, error } — url is null and
 * error is populated when it couldn't be enhanced.
 */
export async function enhanceFaceImage(imageUrl: string): Promise<EnhanceResult> {
  let lastErr = 'unknown error'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fal.subscribe(FACE_ENHANCE_MODEL as any, {
        input: {
          image_url: imageUrl,
          // High fidelity = keep the person's real features (light retouch, not
          // a redraw). 0.7–0.9 is the "preserve identity" band for CodeFormer.
          fidelity: 0.8,
          upscaling: 2,
          face_upsample: true,
        },
        logs: false,
      })
      const url = pickUrl(result)
      if (url) return { url, error: null }
      lastErr = 'model returned no image'
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }
  return { url: null, error: lastErr }
}
