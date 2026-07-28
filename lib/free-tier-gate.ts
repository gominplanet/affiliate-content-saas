// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Free ('trial') plan qualification gate. The free plan includes 5 lifetime
// posts, but a creator must connect a YouTube channel AND a WordPress site
// before generation unlocks — the bar that keeps free AI for real creators,
// not signup-and-farm bots. Paid tiers always pass. Enforce BEFORE any AI spend.

import { getWordPressCredentials } from '@/lib/wordpress-sites'
import type { Tier } from '@/lib/tier'

/**
 * Returns a friendly, user-facing reason to BLOCK free-tier generation, or null
 * when generation is allowed. Only the 'trial' (Free) tier is gated.
 */
export async function freeTierGenerationBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  tier: Tier,
): Promise<string | null> {
  if (tier !== 'trial') return null

  const [wp, ytConnected] = await Promise.all([
    getWordPressCredentials(supabase, userId).catch(() => null),
    hasConnectedYouTube(supabase, userId),
  ])

  if (!wp && !ytConnected) return 'Connect your YouTube channel and a WordPress site to start your 5 free posts.'
  if (!ytConnected) return 'Connect your YouTube channel to start your 5 free posts.'
  if (!wp) return 'Connect a WordPress site to start your 5 free posts.'
  return null
}

/** True when the account has any connected YouTube channel — a youtube_channels
 *  row (modern) or the legacy integrations.youtube_channel_id column. */
async function hasConnectedYouTube(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<boolean> {
  try {
    const { count } = await supabase
      .from('youtube_channels')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    if ((count ?? 0) > 0) return true
  } catch { /* table/columns may lag; fall through to legacy */ }
  try {
    const { data } = await supabase
      .from('integrations')
      .select('youtube_channel_id')
      .eq('user_id', userId)
      .maybeSingle()
    return !!(data?.youtube_channel_id)
  } catch {
    return false
  }
}
