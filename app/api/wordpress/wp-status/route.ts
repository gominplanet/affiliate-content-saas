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

export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await supabase
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.wordpress_url || !intRow?.wordpress_username || !intRow?.wordpress_app_password) {
    return NextResponse.json({ connected: false })
  }

  const wpBase = intRow.wordpress_url.replace(/\/$/, '')
  const cleanPw = intRow.wordpress_app_password.replace(/\s+/g, '')
  const auth = `Basic ${Buffer.from(`${intRow.wordpress_username}:${cleanPw}`).toString('base64')}`

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
    const s = await res.json() as { plugin_version: string | null; theme_version: string | null }

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
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'WP unreachable'
    return NextResponse.json({ connected: true, error: msg })
  }
}
