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

export const maxDuration = 120

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: intRow } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password')
    .eq('user_id', user.id)
    .single()

  if (!intRow?.wordpress_url || !intRow?.wordpress_username || !intRow?.wordpress_app_password) {
    return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
  }

  const wpBase = intRow.wordpress_url.replace(/\/$/, '')
  const cleanPw = intRow.wordpress_app_password.replace(/\s+/g, '')
  const auth = `Basic ${Buffer.from(`${intRow.wordpress_username}:${cleanPw}`).toString('base64')}`

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
