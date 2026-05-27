/**
 * POST /api/seo/purge-sitemap
 *
 * Asks the MVP WordPress plugin (v1.0.13+) to purge the host sitemap cache so
 * newly published posts appear in the sitemap immediately instead of waiting
 * out a multi-day cache TTL. Lets the dashboard clear a stale-sitemap warning
 * without a wp-admin trip.
 */
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wp } = await (supabase as any)
    .from('integrations')
    .select('wordpress_url,wordpress_username,wordpress_app_password')
    .eq('user_id', user.id).single()
  if (!wp?.wordpress_url || !wp?.wordpress_username || !wp?.wordpress_app_password) {
    return NextResponse.json({ error: 'WordPress not connected.' }, { status: 400 })
  }
  const wpBase = wp.wordpress_url.replace(/\/$/, '')
  const auth = `Basic ${Buffer.from(`${wp.wordpress_username}:${wp.wordpress_app_password.replace(/\s+/g, '')}`).toString('base64')}`

  try {
    const res = await fetch(`${wpBase}/wp-json/affiliateos/v1/purge-sitemap`, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (res.status === 404) {
      return NextResponse.json(
        { error: 'Sitemap refresh needs the MVP plugin v1.0.13+ — update it (Setup → reinstall, or the dashboard “Update now”), then try again.' },
        { status: 409 },
      )
    }
    if (!res.ok) return NextResponse.json({ error: `WordPress returned ${res.status}.` }, { status: 502 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'WordPress unreachable' }, { status: 502 })
  }
}
