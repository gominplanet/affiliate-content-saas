// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// THE AMAZON PLAN'S VIDEO ALLOWANCES (Seb, 2026-10-05: all six additions, for
// current and new Amazon members). Read by the routes that enforce them and by
// every page that sells them, so the number shown is the number enforced.
export const AMAZON_COPILOT_RUNS_PER_MONTH = 100
export const AMAZON_LIVE_SHOWS_PER_MONTH = 4
export const AMAZON_FIND_MOMENTS_PER_MONTH = 20
export const AMAZON_CLIPS_PER_MONTH = 50
export const AMAZON_YOUTUBE_CHANNELS = 1


/** Bulk Amazon upload and Clip Factory: Pro, admin, and the Amazon plan since
 *  2026-10-05. The Amazon plan's clips and Find moments have their own
 *  allowances above; everything else in these tools is the same. */
export function hasVideoTools(rawTier: unknown): boolean {
  // Read directly rather than through lib/tier's normalizeTier: lib/tier
  // imports this file, and these three names are never aliased.
  const t = String(rawTier ?? '').trim().toLowerCase()
  return t === 'pro' || t === 'admin' || t === 'amazon'
}
