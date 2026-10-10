// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// The page side of a background render (lib/render-job): is a clip rendering
// right now, and watch it until the service has reported. Shared by Clip
// Factory and the Shorts Studio popup so they say the same thing.

import type { ShortRow } from '@/lib/shorts-types'

/** Same as BACKGROUND_RENDER_STALE_MS in lib/render-job (that file is server only). */
export const BACKGROUND_STALE_MS = 25 * 60_000

/** Rendering in the background, and recently enough that it may still finish.
 *  An older one never reported back, and the card offers Render again. Pure. */
export function renderingInBackground(clip: Pick<ShortRow, 'status' | 'updatedAt'>, now = Date.now()): boolean {
  if (clip.status !== 'rendering') return false
  const at = clip.updatedAt ? Date.parse(clip.updatedAt) : NaN
  return !Number.isFinite(at) || now - at < BACKGROUND_STALE_MS
}

/** Look every 15 seconds until the clip is rendered or failed, or the wait runs
 *  out. Returns the clip as it ended, or null when it never reported. */
export async function waitForBackgroundRender(videoId: string, clipId: string, maxMs = BACKGROUND_STALE_MS): Promise<ShortRow | null> {
  const until = Date.now() + maxMs
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 15_000))
    try {
      const res = await fetch(`/api/youtube/shorts?videoId=${encodeURIComponent(videoId)}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
      const d = await res.json().catch(() => ({}))
      const now = (d.shorts as ShortRow[] | undefined)?.find((c) => c.id === clipId)
      if (now && (now.status === 'rendered' || now.status === 'failed')) return now
    } catch { /* offline for a moment: look again */ }
  }
  return null
}
