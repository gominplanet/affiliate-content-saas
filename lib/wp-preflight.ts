// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential.
//
// Shared WordPress publish pre-flight, used by every generator that ends in a
// WP publish (blog enqueue, comparison, campaigns). Verifies the site can
// actually accept a write BEFORE the (billed) AI work runs — so a blocked
// connection (firewall/WAF, deactivated plugin, bad app password) fails at the
// door with the Connection Doctor instead of dying at the publish step and
// burning the generation.

import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { createWordPressService } from '@/services/wordpress'
import { alertOps } from '@/lib/ops-alert'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

// Operator-alert throttle — don't ping on every click from the same stuck
// owner. Module-level (per warm instance), same good-enough approach the
// failure-spike alert in process-generation-jobs uses.
const WP_BLOCK_ALERT_THROTTLE_MS = 6 * 60 * 60_000
const lastWpBlockAlertAt = new Map<string, number>()

export interface WpPreflightBlock {
  error: string
  reason: 'wp_connection'
  doctorUrl: '/setup/wp-doctor'
}

/** Returns a block payload (surface it as a 422) when the owner's WordPress
 *  site refuses a test write, else null (proceed). content-only / no-site
 *  owners always pass — there's nothing to publish to. Best-effort operator
 *  alert on a fresh block. Never throws — a probe error resolves to "proceed"
 *  so a bug here can't wedge generation. */
export async function preflightWpPublish(
  supabase: Client,
  ownerId: string,
  siteId?: string | null,
): Promise<WpPreflightBlock | null> {
  try {
    const site = await getWordPressCredentials(supabase, ownerId, siteId || undefined)
    if (!site || site.content_only) return null

    const svc = createWordPressService(
      site.wordpress_url,
      site.wordpress_username,
      site.wordpress_app_password,
      site.wordpress_api_token || undefined,
    )
    const probe = await svc.verifyPublishReady()
    if (probe.ok) return null

    // Operator heads-up (throttled per owner) — hear about a stuck creator
    // before they email. Best-effort; never blocks the caller.
    const now = Date.now()
    if (now - (lastWpBlockAlertAt.get(ownerId) || 0) > WP_BLOCK_ALERT_THROTTLE_MS) {
      lastWpBlockAlertAt.set(ownerId, now)
      alertOps(
        'WordPress publish blocked — a creator can\'t publish',
        `Owner: ${ownerId}\nSite: ${site.wordpress_url}\nPre-flight write-test failed:\n${probe.detail || 'unknown'}`,
      ).catch(() => { /* alerting is best-effort */ })
    }

    return {
      // request() already throws the friendly firewall→doctor message on a WAF/
      // HTML block; surface it verbatim, else a generic actionable line.
      error: probe.detail && /Connection Doctor/.test(probe.detail)
        ? probe.detail
        : "Your WordPress connection is currently blocked, so this can't publish. Run the Connection Doctor to fix it, then try again — no generation was used.",
      reason: 'wp_connection',
      doctorUrl: '/setup/wp-doctor',
    }
  } catch {
    // A pre-flight bug must never wedge generation — fail open (proceed).
    return null
  }
}
