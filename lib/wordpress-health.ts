// © 2026 Gominplanet / MVP Affiliate — proprietary & confidential. No copying, redistribution, reverse-engineering, or reuse. See LICENSE.
//
// Shared WordPress connection-health helpers.
//
// THE single authoritative "is this WordPress site actually connected
// right now" check. Every "Connected" badge, every wpReady gate, every
// onboarding checklist tick must call probeWpHealth() — never read DB
// fields directly. The DB-truthy-check approach (`!!integrations.
// wordpress_url`) caused a long-standing UX bug where badges flipped
// green on save, even when WordPress rejected the credentials with 401.
//
// /api/wordpress/health is a thin wrapper around this; server components
// (dashboard checklist, content gates) can call it directly without the
// network round-trip.

import type { SupabaseClient } from '@supabase/supabase-js'
import { getWordPressCredentials } from './wordpress-sites'

export type WpHealthState =
  | 'verified'        // Basic Auth OK + plugin installed + REST routable
  | 'auth_failed'     // 401/403 — AP revoked, wrong, or stripped header
  | 'plugin_missing'  // 404 from /status — plugin uninstalled/deactivated
  | 'unreachable'     // network error, 5xx, or /wp-json/ returns non-2xx
  | 'no_creds'        // no integrations row + no wordpress_sites row

export interface WpHealthDetails {
  url: string
  username: string
  pluginInstalled: boolean
  pluginVersion: string | null
  proxyEnabled: boolean
  /** Whether the MVP Affiliate theme is installed / active. Only populated on a
   *  'verified' result (the plugin's /status reports it). Undefined otherwise. */
  themeInstalled?: boolean
  themeActive?: boolean
  httpStatus?: number
}

export interface WpHealth {
  state: WpHealthState
  message: string
  lastCheckedAt: string
  details?: WpHealthDetails
}

/** Probe a user's WordPress site and return its health state. Pure: does
 *  no DB writes. Callers should treat the result as ephemeral and not
 *  cache longer than a few minutes — credentials can change at any time. */
export async function probeWpHealth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  userId: string,
  siteId?: string | null,
): Promise<WpHealth> {
  const site = await getWordPressCredentials(supabase, userId, siteId ?? null)
  const nowIso = new Date().toISOString()

  if (!site) {
    return {
      state: 'no_creds',
      message: 'No WordPress site connected yet.',
      lastCheckedAt: nowIso,
    }
  }

  const wpBase = site.wordpress_url.replace(/\/+$/, '')
  const cleanPw = site.wordpress_app_password.replace(/\s+/g, '')
  const auth = `Basic ${Buffer.from(`${site.wordpress_username}:${cleanPw}`).toString('base64')}`
  const baseDetails = { url: site.wordpress_url, username: site.wordpress_username }

  // 1. Reachability check via /wp-json/ — short timeout so a stalled
  //    host doesn't make the dashboard hang.
  try {
    const reachRes = await fetch(`${wpBase}/wp-json/`, { signal: AbortSignal.timeout(6_000) })
    if (!reachRes.ok) {
      return {
        state: 'unreachable',
        message: `Couldn't reach ${site.wordpress_url} (HTTP ${reachRes.status}).`,
        lastCheckedAt: nowIso,
        details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: reachRes.status },
      }
    }
  } catch {
    return {
      state: 'unreachable',
      message: `Couldn't reach ${site.wordpress_url}. Check the URL.`,
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false },
    }
  }

  // 2. Authenticated /status probe — the strictest end-to-end test.
  //    Requires manage_options + valid Basic Auth + the plugin active.
  let statusRes: Response
  try {
    statusRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/status`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return {
      state: 'unreachable',
      message: 'Timed out reading your WordPress status. Try again in a minute.',
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false },
    }
  }

  if (statusRes.status === 401 || statusRes.status === 403) {
    return {
      state: 'auth_failed',
      message: 'Your saved Application Password is no longer valid. Reconnect WordPress to refresh it.',
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: statusRes.status },
    }
  }

  if (statusRes.status === 404) {
    return {
      state: 'plugin_missing',
      message: 'The MVP Affiliate plugin isn\'t installed or active on this site.',
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: 404 },
    }
  }

  if (!statusRes.ok) {
    return {
      state: 'unreachable',
      message: `WordPress returned HTTP ${statusRes.status}.`,
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: statusRes.status },
    }
  }

  const s = await statusRes.json().catch(() => ({})) as {
    plugin_version?: string | null
    proxy_secret?: string | null
    theme_version?: string | null
    theme_active?: boolean
  }

  return {
    state: 'verified',
    message: `Connected as ${site.wordpress_username}. Plugin v${s.plugin_version || 'unknown'}.`,
    lastCheckedAt: nowIso,
    details: {
      ...baseDetails,
      pluginInstalled: true,
      pluginVersion: s.plugin_version || null,
      proxyEnabled: !!s.proxy_secret,
      themeInstalled: s.theme_version != null,
      themeActive: s.theme_active === true,
      httpStatus: 200,
    },
  }
}

/** Standalone probe: pings a SPECIFIC url + username + appPassword
 *  combination without needing them to already be in the DB. Used by
 *  addSite() to verify creds BEFORE inserting them — refusing to save
 *  a broken connection is better than saving and surfacing the error
 *  later via the dashboard's health badge.
 *
 *  Returns the same shape as probeWpHealth so the UI/server code can
 *  branch on .state identically. */
export async function probeUnverifiedCreds(opts: {
  url: string
  username: string
  appPassword: string
}): Promise<WpHealth> {
  const wpBase = opts.url.replace(/\/+$/, '')
  const cleanPw = opts.appPassword.replace(/\s+/g, '')
  const auth = `Basic ${Buffer.from(`${opts.username}:${cleanPw}`).toString('base64')}`
  const nowIso = new Date().toISOString()
  const baseDetails = { url: opts.url, username: opts.username }

  try {
    const reachRes = await fetch(`${wpBase}/wp-json/`, { signal: AbortSignal.timeout(6_000) })
    if (!reachRes.ok) {
      return {
        state: 'unreachable',
        message: `Couldn't reach ${opts.url} (HTTP ${reachRes.status}).`,
        lastCheckedAt: nowIso,
        details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: reachRes.status },
      }
    }
  } catch {
    return {
      state: 'unreachable',
      message: `Couldn't reach ${opts.url}. Check the URL.`,
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false },
    }
  }

  let statusRes: Response
  try {
    statusRes = await fetch(`${wpBase}/wp-json/affiliateos/v1/status`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return {
      state: 'unreachable',
      message: 'Timed out reading your WordPress status.',
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false },
    }
  }

  if (statusRes.status === 401 || statusRes.status === 403) {
    return {
      state: 'auth_failed',
      message: 'WordPress rejected the credentials. Double-check the username and Application Password.',
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: statusRes.status },
    }
  }

  if (statusRes.status === 404) {
    return {
      state: 'plugin_missing',
      message: 'The MVP Affiliate plugin isn\'t installed on this site. Install it first, then try again.',
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: 404 },
    }
  }

  if (!statusRes.ok) {
    return {
      state: 'unreachable',
      message: `WordPress returned HTTP ${statusRes.status}.`,
      lastCheckedAt: nowIso,
      details: { ...baseDetails, pluginInstalled: false, pluginVersion: null, proxyEnabled: false, httpStatus: statusRes.status },
    }
  }

  const s = await statusRes.json().catch(() => ({})) as {
    plugin_version?: string | null
    proxy_secret?: string | null
  }

  return {
    state: 'verified',
    message: `Verified as ${opts.username}.`,
    lastCheckedAt: nowIso,
    details: {
      ...baseDetails,
      pluginInstalled: true,
      pluginVersion: s.plugin_version || null,
      proxyEnabled: !!s.proxy_secret,
      httpStatus: 200,
    },
  }
}
