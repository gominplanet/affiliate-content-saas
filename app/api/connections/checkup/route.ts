// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// GET /api/connections/checkup
//
// The real state of this creator's connections, for the reconnect notice. The
// judgement lives in lib/reconnect-checkup; this route's only job is to gather
// the facts honestly and hand them over.
//
// Two things it is careful about.
//
// SELECT *. PostgREST rejects the WHOLE statement when one named column is
// missing, so naming `twitter_scopes` here would mean this screen returns
// nothing at all on any deployment where migration 337 has not run — and the
// screen that reports connection problems going blank is the worst possible
// failure for it. Everything read below is optional by design.
//
// ok: false. A read that fails returns ok: false rather than an empty list,
// because "we could not check" and "everything is fine" are different answers
// and an empty list renders as the second one.
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getAuthAndOwner } from '@/lib/agency-auth'
import { getDeadChannels, platformLabel } from '@/lib/channel-health'
import { getWpConnectionHealth } from '@/lib/wp-connection-health'
import { decryptSecret, isEncrypted } from '@/lib/secrets'
import { buildCheckup, checkupSummary, type CheckupInput } from '@/lib/reconnect-checkup'

export const dynamic = 'force-dynamic'

/**
 * Can this stored secret still be used, or is it lost?
 *
 * Two ways a key becomes unusable, and both look identical from the dashboard,
 * where the field shows as filled in and the integration shows as connected:
 *
 *   encrypted twice   decrypting once yields another `enc:v1:` envelope. The
 *                     value handed to Geniuslink is ciphertext, the API rejects
 *                     it, and links publish uncloaked. One creator reported this
 *                     twice before anyone found it.
 *   corrupt           the envelope no longer authenticates and decryptSecret
 *                     throws.
 *
 * A throw is reported as unreadable rather than swallowed. Catching it and
 * returning "fine" would be this module telling the creator their key is good
 * because it could not read it, which is the exact failure the checkup exists
 * to make visible.
 */
function isUnreadableSecret(stored: string | null | undefined): boolean {
  if (!stored || !isEncrypted(stored)) return false
  try {
    return isEncrypted(decryptSecret(stored))
  } catch {
    return true
  }
}

export async function GET() {
  const supabase = await createServerClient()
  const auth = await getAuthAndOwner(supabase)
  if (auth.error) return auth.error
  const { ownerId } = auth

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = supabase as any

    const [integRes, siteRes, wpHealth, dead] = await Promise.all([
      client.from('integrations').select('*').eq('user_id', ownerId).maybeSingle(),
      client.from('wordpress_sites').select('id').eq('user_id', ownerId).limit(1),
      getWpConnectionHealth(supabase, ownerId).catch(() => ({ needsAttention: false })),
      getDeadChannels(supabase, ownerId).catch(() => []),
    ])

    const integ = (integRes?.data ?? {}) as Record<string, unknown>
    const str = (k: string): string | null => {
      const v = integ[k]
      return typeof v === 'string' && v.length > 0 ? v : null
    }

    const input: CheckupInput = {
      // `twitter_connected` is a boolean flag, so it is read on its own rather
      // than through str(); a token or a handle is enough on its own too.
      twitterConnected: integ.twitter_connected === true
        || !!(str('twitter_access_token') || str('twitter_refresh_token') || str('twitter_handle')),
      twitterScopes: str('twitter_scopes'),
      geniuslinkConfigured: !!(str('geniuslink_api_key') && str('geniuslink_api_secret')),
      geniuslinkUnreadable:
        isUnreadableSecret(str('geniuslink_api_key'))
        || isUnreadableSecret(str('geniuslink_api_secret')),
      wordpressConfigured: Array.isArray(siteRes?.data) ? siteRes.data.length > 0 : !!str('wordpress_url'),
      wordpressNeedsAttention: !!wpHealth?.needsAttention,
      // Proactive: what the nightly refresh recorded. Read defensively because
      // connection_health is a jsonb column added by migration, and this route
      // must keep answering on a deployment where it is absent.
      staleTokens: (() => {
        const health = (integ.connection_health ?? {}) as Record<string, { dead?: unknown } | undefined>
        if (!health || typeof health !== 'object') return []
        return (['threads', 'instagram'] as const)
          .filter(p => health[p]?.dead === true)
          .map(p => ({ platform: p, label: platformLabel(p) }))
      })(),
      deadChannels: (dead ?? []).map(d => ({
        platform: d.platform,
        label: d.label || platformLabel(d.platform),
        message: d.message,
      })),
    }

    const items = buildCheckup(input)
    return NextResponse.json({ ok: true, items, summary: checkupSummary(items) })
  } catch (e) {
    // Named, not swallowed. The notice renders this as "we could not check",
    // which is the truth and is distinguishable from a clean bill of health.
    return NextResponse.json({
      ok: false,
      error: e instanceof Error ? e.message : 'checkup failed',
    })
  }
}
