/**
 * POST /api/wordpress/self-update
 *
 * Triggers the plugin's /affiliateos/v1/self-update route (Basic Auth),
 * which pulls + installs the latest theme + plugin zips on the user's
 * WordPress site. Called by the dashboard "Update now" button so users
 * never have to visit wp-admin.
 *
 * The WP side does the heavy lifting (download + unzip + install both
 * packages) — that can take 20-60s, hence the long maxDuration.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { getWordPressCredentials } from '@/lib/wordpress-sites'
import { tryWpProxy } from '@/lib/wp-proxy'

export const maxDuration = 120

export async function POST(req: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Multi-site: accepts `siteId` to update a specific site's plugin/theme.
  // Omitted → default site. Multi-site users update each site individually.
  const body = await req.json().catch(() => ({})) as { siteId?: string | null }
  const site = await getWordPressCredentials(supabase, user.id, body.siteId)
  if (!site) {
    return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
  }

  const wpBase = site.wordpress_url.replace(/\/$/, '')

  // ── 1. Body-auth proxy path (plugin v1.0.25+) — bypasses Authorization
  //       header stripping on Hostinger LiteSpeed and similar hosts.
  //       Only useful on plugin upgrades AFTER the first install of v1.0.25
  //       (the proxy_secret needs to be persisted via /status first); for
  //       the chicken-and-egg first upgrade from <1.0.25, the user manually
  //       installs from /mvp-affiliate.zip via wp-admin.
  const proxied = await tryWpProxy({
    siteUrl: wpBase,
    proxySecret: site.wordpress_api_token,
    innerPath: '/affiliateos/v1/self-update',
    method: 'POST',
    timeoutMs: 110_000,
  })
  if (proxied) {
    if (!proxied.ok && proxied.status === 404) {
      return NextResponse.json(
        { error: 'Your installed plugin is too old for one-click update. Do one manual update first (Setup → reinstall), then this works forever.' },
        { status: 409 },
      )
    }
    return NextResponse.json(proxied.data, { status: proxied.ok ? 200 : 207 })
  }

  // ── 2. Legacy Basic-Auth path (plugin <1.0.25 or no proxy_secret stored yet)
  const cleanPw = site.wordpress_app_password.replace(/\s+/g, '')
  const auth = `Basic ${Buffer.from(`${site.wordpress_username}:${cleanPw}`).toString('base64')}`

  try {
    const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/self-update`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(110_000),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 404) {
      return NextResponse.json(
        { error: 'Your installed plugin is too old for one-click update. Do one manual update first (Setup → reinstall), then this works forever.' },
        { status: 409 },
      )
    }
    // WP returns 200 (all ok) or 207 (partial). Surface the per-target detail.
    return NextResponse.json(data, { status: res.ok ? 200 : 207 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'WordPress unreachable'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
