/**
 * GET /api/wordpress/wp-status
 *
 * Reads the installed theme + plugin versions off the user's WordPress
 * site (via the plugin's /affiliateos/v1/status route, Basic Auth) and
 * compares them to the latest published versions. Powers the dashboard
 * "Update available → Update now" banner.
 *
 * Response:
 *   { connected, theme:{installed,latest,updateAvailable}, plugin:{...} }
 *   connected=false when WP isn't set up, or status route 404s (old
 *   plugin without the endpoint — they must do one manual update first).
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { WP_VERSIONS } from '@/lib/wp-versions'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { maybeEncrypt } from '@/lib/secrets'

function gt(a: string | null, b: string): boolean {
  if (!a) return false
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0, y = pb[i] ?? 0
    if (x !== y) return y > x // latest (b) greater than installed (a)
  }
  return false
}

export async function GET(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Multi-site: accepts ?siteId=<uuid> to check a specific site; omitted
  // → user's default site (the dashboard's primary "Update available" banner).
  // A per-site loop UI can call this N times with different siteIds.
  const url = new URL(req.url)
  const siteId = url.searchParams.get('siteId')
  const site = await getWordPressCredentials(supabase, user.id, siteId)
  if (!site) {
    return NextResponse.json({ connected: false })
  }

  const wpBase = site.wordpress_url.replace(/\/$/, '')
  const cleanPw = site.wordpress_app_password.replace(/\s+/g, '')
  const auth = `Basic ${Buffer.from(`${site.wordpress_username}:${cleanPw}`).toString('base64')}`

  try {
    const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/status`, {
      headers: { Authorization: auth },
      // Don't let a slow WP host hang the dashboard.
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404) {
      // Plugin too old to have /status — needs one manual update to v1.0.6.
      return NextResponse.json({ connected: true, needsManualUpdate: true })
    }
    if (res.status === 401 || res.status === 403) {
      // The stored Application Password is no longer valid (revoked, WP
      // password changed, security plugin, site migrated). Brand syncs and
      // publishing will fail until the user reconnects — surface it loudly.
      return NextResponse.json({ connected: true, authFailed: true })
    }
    if (!res.ok) {
      return NextResponse.json({ connected: true, error: `WP status ${res.status}` })
    }
    const s = await res.json() as {
      plugin_version: string | null
      theme_version: string | null
      proxy_secret?: string | null
    }

    // Auto-upgrade dance: plugin v1.0.25+ ships a body-auth proxy secret on
    // /status. The dashboard stores it in wordpress_sites.api_token so every
    // write afterwards goes through the header-free proxy. We do this on
    // every status check — it's idempotent and ensures we never miss a
    // post-update sync. The secret is the same on every fetch unless the
    // user uninstalls + reinstalls the plugin (rare); the UPDATE only fires
    // when stored ≠ fresh, so steady state is a no-op.
    if (s.proxy_secret) {
      try {
        // Find which wordpress_sites row (if any) this site corresponds to,
        // identified by URL. We don't trust caller-supplied siteId here —
        // RLS would let one user write another's row otherwise.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabase as any
        const { data: existing } = await sb
          .from('wordpress_sites')
          .select('id, api_token')
          .eq('user_id', user.id)
          .eq('url', site.wordpress_url)
          .maybeSingle()
        if (existing && existing.api_token !== s.proxy_secret) {
          await sb
            .from('wordpress_sites')
            .update({ api_token: maybeEncrypt(s.proxy_secret) })
            .eq('id', existing.id)
        }
        // Also mirror to the legacy integrations column so single-site users
        // who haven't been migrated to wordpress_sites still get the proxy.
        await sb
          .from('integrations')
          .update({ wordpress_api_token: maybeEncrypt(s.proxy_secret) })
          .eq('user_id', user.id)
      } catch { /* non-fatal — proxy will be retried next status check */ }
    }

    const themeLatest = WP_VERSIONS.theme.version
    const pluginLatest = WP_VERSIONS.plugin.version
    return NextResponse.json({
      connected: true,
      theme: {
        installed: s.theme_version,
        latest: themeLatest,
        updateAvailable: gt(s.theme_version, themeLatest),
      },
      plugin: {
        installed: s.plugin_version,
        latest: pluginLatest,
        updateAvailable: gt(s.plugin_version, pluginLatest),
      },
      // Surface whether the body-auth proxy is wired up for this site —
      // useful for debug-write to report and for the Settings UI to show
      // a "header-free writes enabled ✓" pill in a future polish pass.
      proxyEnabled: !!s.proxy_secret,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'WP unreachable'
    return NextResponse.json({ connected: true, error: msg })
  }
}
