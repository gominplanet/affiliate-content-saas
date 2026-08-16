/**
 * GET /api/social/health — dead social connections for the signed-in user.
 *
 * Powers the topbar "reconnect" alert AND the dashboard reconnect banner. A
 * channel is surfaced as dead in two ways:
 *   1. REACTIVE (lib/channel-health): it has failed N scheduled posts in a row
 *      with no success since — an expired token, a never-connected platform
 *      still in the schedule, or one that keeps erroring.
 *   2. PROACTIVE (lib/connection-probe): a live token probe of Facebook + YouTube
 *      — the two that die SILENTLY with a false "connected" green. This catches a
 *      dead connection the moment it dies, before it costs the creator any posts.
 *
 * The probe is lazy + cached (connection_health_at, 6h fresh window) so it adds a
 * Graph/Google round-trip at most a few times a day per user; the daily cron
 * keeps everyone fresh regardless.
 *
 * VA-aware: reports on the OWNER's channels, since that's whose connections publish.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getDeadChannels, platformLabel, type DeadChannel } from '@/lib/channel-health'
import { probeAndStoreConnections, isHealthFresh, deadPlatforms, type ConnectionHealth } from '@/lib/connection-probe'

export const dynamic = 'force-dynamic'

// Where "Reconnect" should send the creator for each platform.
const RECONNECT_HREF: Record<string, string> = {
  youtube: '/connect-youtube',
}
const reconnectHref = (platform: string): string => RECONNECT_HREF[platform] || '/connect-socials'

const PROACTIVE_MESSAGE: Record<string, string> = {
  facebook: 'Your Facebook connection dropped — Meta invalidates it after a password change or a periodic security reset. Reconnect it so your posts keep going out.',
  youtube: 'Your YouTube connection dropped and needs reconnecting. Until you do, MVP can’t sync new videos or publish on your behalf.',
}

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  // 1. Reactive — scheduled-post failure history.
  const dead: DeadChannel[] = await getDeadChannels(supabase, ownerId)

  // 2. Proactive — live probe of FB + YT, reusing a fresh cached result.
  let health: ConnectionHealth | null = null
  try {
    const { data: row } = await supabase
      .from('integrations')
      .select('facebook_page_id,facebook_page_access_token,youtube_oauth_refresh_token,youtube_oauth_access_token,connection_health,connection_health_at')
      .eq('user_id', ownerId)
      .maybeSingle()
    if (row) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = row as any
      if (isHealthFresh(r.connection_health_at)) {
        health = (r.connection_health as ConnectionHealth) || null
      } else {
        health = await probeAndStoreConnections(supabase, ownerId, r)
      }
    }
  } catch { /* probing is best-effort — never break the health read */ }

  // Merge probe-dead platforms in, without duplicating a platform the reactive
  // pass already flagged.
  const seen = new Set(dead.map(d => d.platform))
  for (const platform of deadPlatforms(health)) {
    if (seen.has(platform)) continue
    dead.push({
      platform,
      label: platformLabel(platform),
      consecutiveFailures: 0,
      lastError: health?.[platform]?.reason || '',
      lastFailedAt: null,
      reason: 'expired',
      message: PROACTIVE_MESSAGE[platform] || `Your ${platformLabel(platform)} connection needs reconnecting.`,
    })
  }

  // Attach a per-platform reconnect destination (YouTube ≠ Connect Socials).
  const withHref = dead.map(d => ({ ...d, href: reconnectHref(d.platform) }))
  return NextResponse.json({ dead: withHref, count: withHref.length })
}
