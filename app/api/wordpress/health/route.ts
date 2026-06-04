// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// GET /api/wordpress/health
//
// THE single authoritative WordPress connection check for the dashboard.
// Every "Connected" badge / pill / checklist tick in the UI should read
// from this endpoint instead of looking at DB fields directly — the
// long-standing UX bug was that the badges read truthiness off
// integrations.wordpress_url + wordpress_app_password, which would flip
// green the instant credentials were written, even if WP itself rejected
// them with 401. Test connection would then say "wrong password" while
// the badge said "Connected", and users (rightly) lost trust.
//
// What this endpoint actually verifies (in order):
//   1. Credentials exist for the user (or specified siteId)
//   2. {site}/wp-json/ is reachable
//   3. {site}/wp-json/affiliateos/v1/status returns 200 with our plugin's
//      Basic-Auth payload. This single call catches:
//      - Application Password revoked or wrong (401/403)
//      - MVP Affiliate plugin uninstalled or deactivated (404)
//      - REST API broken (any 5xx, network error)
//      - Hostinger/LiteSpeed stripping the Authorization header (401)
//      - User's WP role lost manage_options (403)
//
// Response shape:
//   {
//     state: 'verified' | 'auth_failed' | 'plugin_missing' | 'unreachable' | 'no_creds',
//     message: string,                  // human-facing one-liner
//     lastCheckedAt: ISO timestamp,
//     details?: {
//       url, username, pluginInstalled, pluginVersion, proxyEnabled, httpStatus?
//     }
//   }

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'

export const maxDuration = 15

interface HealthDetails {
  url: string
  username: string
  pluginInstalled: boolean
  pluginVersion: string | null
  proxyEnabled: boolean
  httpStatus?: number
}

interface HealthResponse {
  state: 'verified' | 'auth_failed' | 'plugin_missing' | 'unreachable' | 'no_creds'
  message: string
  lastCheckedAt: string
  details?: HealthDetails
}

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const siteId = url.searchParams.get('siteId')

  const site = await getWordPressCredentials(supabase, user.id, siteId)
  const nowIso = new Date().toISOString()

  if (!site) {
    const resp: HealthResponse = {
      state: 'no_creds',
      message: 'No WordPress site connected yet.',
      lastCheckedAt: nowIso,
    }
    return NextResponse.json(resp)
  }

  const wpBase = site.wordpress_url.replace(/\/+$/, '')
  // Strip whitespace from the AP — wp-admin renders it in groups of 4 and
  // users routinely paste-with-spaces. Same defensive clean-up as
  // wp-status + connect-token.
  const cleanPw = site.wordpress_app_password.replace(/\s+/g, '')
  const auth = `Basic ${Buffer.from(`${site.wordpress_username}:${cleanPw}`).toString('base64')}`

  const baseDetails = {
    url: site.wordpress_url,
    username: site.wordpress_username,
  }

  // 1. Reachability check. We ping /wp-json/ (the REST root) first so a
  //    completely down/blocked site returns 'unreachable' rather than
  //    misleading 'auth_failed'. Short timeout — we'd rather show
  //    "unreachable" than make the dashboard hang.
  try {
    const reachRes = await fetch(`${wpBase}/wp-json/`, {
      signal: AbortSignal.timeout(6_000),
    })
    if (!reachRes.ok) {
      const resp: HealthResponse = {
        state: 'unreachable',
        message: `Couldn't reach ${site.wordpress_url} (HTTP ${reachRes.status}). The site might be down or the REST API is blocked.`,
        lastCheckedAt: nowIso,
        details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: reachRes.status },
      }
      return NextResponse.json(resp)
    }
  } catch {
    const resp: HealthResponse = {
      state: 'unreachable',
      message: `Couldn't reach ${site.wordpress_url}. Check the URL is correct and the site is up.`,
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false },
    }
    return NextResponse.json(resp)
  }

  // 2. The real verification: the plugin's authenticated /status endpoint.
  //    Requires manage_options + valid Basic Auth + the plugin installed.
  let statusRes: Response
  try {
    statusRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/status`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    const resp: HealthResponse = {
      state: 'unreachable',
      message: 'Timed out reading your WordPress status. Try again in a minute.',
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false },
    }
    return NextResponse.json(resp)
  }

  if (statusRes.status === 401 || statusRes.status === 403) {
    const resp: HealthResponse = {
      state: 'auth_failed',
      message: 'Your saved Application Password is no longer valid. Reconnect WordPress to refresh it.',
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: statusRes.status },
    }
    return NextResponse.json(resp)
  }

  if (statusRes.status === 404) {
    const resp: HealthResponse = {
      state: 'plugin_missing',
      message: 'The MVP Affiliate plugin isn\'t installed or active on this site. Install it via the wizard, then test again.',
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: 404 },
    }
    return NextResponse.json(resp)
  }

  if (!statusRes.ok) {
    const resp: HealthResponse = {
      state: 'unreachable',
      message: `WordPress returned HTTP ${statusRes.status}. The site might be misconfigured.`,
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: statusRes.status },
    }
    return NextResponse.json(resp)
  }

  // 200 OK — fully verified.
  const s = await statusRes.json().catch(() => ({})) as {
    plugin_version?: string | null
    proxy_secret?: string | null
  }

  const resp: HealthResponse = {
    state: 'verified',
    message: `Connected as ${site.wordpress_username}. Plugin v${s.plugin_version || 'unknown'}.`,
    lastCheckedAt: nowIso,
    details: {
      ...baseDetails,
      pluginInstalled: true,
      pluginVersion: s.plugin_version || null,
      proxyEnabled: !!s.proxy_secret,
      httpStatus: 200,
    },
  }
  return NextResponse.json(resp)
}
