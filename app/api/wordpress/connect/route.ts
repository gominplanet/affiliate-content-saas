import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteUrl: rawUrl, username, appPassword, apiToken } = await request.json()
  if (!rawUrl || !username) {
    return NextResponse.json({ error: 'Site URL and username are required.' }, { status: 400 })
  }
  if (!appPassword && !apiToken) {
    return NextResponse.json({ error: 'Either an Application Password or API Token is required.' }, { status: 400 })
  }

  // Normalize URL
  let siteUrl = rawUrl.trim()
  if (!siteUrl.startsWith('http')) siteUrl = `https://${siteUrl}`
  siteUrl = siteUrl.replace(/\/wp-admin\/?.*$/, '').replace(/\/$/, '')

  // ── API Token path (Hostinger / hosts that block Application Passwords) ──────
  if (apiToken && !appPassword) {
    // Verify site is reachable
    try {
      const pingRes = await fetch(`${siteUrl}/wp-json/`, {
        headers: { 'X-Content-Tool-Token': apiToken },
      })
      if (!pingRes.ok) {
        return NextResponse.json({ error: `Could not reach your WordPress site (HTTP ${pingRes.status}). Double-check the URL.` }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Could not reach your WordPress site. Double-check the URL.' }, { status: 400 })
    }

    // Save credentials — token auth doesn't expose /users/me without setting current user,
    // so we skip the role check and trust the user has admin access
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('integrations').upsert(
      {
        user_id: user.id,
        wordpress_url: siteUrl,
        wordpress_username: username,
        wordpress_api_token: apiToken,
        setup_status: 'wordpress_ready',
      },
      { onConflict: 'user_id' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, siteUrl, username })
  }

  // ── Application Password path ─────────────────────────────────────────────
  const cleanPassword = (appPassword as string).replace(/\s+/g, '')
  const encoded = Buffer.from(`${username}:${cleanPassword}`).toString('base64')

  let meRes: Response
  try {
    meRes = await fetch(`${siteUrl}/wp-json/wp/v2/users/me`, {
      headers: { Authorization: `Basic ${encoded}` },
    })
  } catch {
    return NextResponse.json({ error: 'Could not reach your WordPress site. Double-check the URL.' }, { status: 400 })
  }

  if (!meRes.ok) {
    if (meRes.status === 401 || meRes.status === 403) {
      return NextResponse.json({
        error: 'Authentication failed. Check your username and Application Password. If you\'re on Hostinger, use the API Token method instead.',
      }, { status: 400 })
    }
    return NextResponse.json({ error: `WordPress returned HTTP ${meRes.status}. Check the site URL.` }, { status: 400 })
  }

  const me = await meRes.json() as { name: string; roles?: string[] }
  const roles = me.roles || []
  const canPublish = roles.some(r => ['administrator', 'editor'].includes(r))
  if (!canPublish) {
    return NextResponse.json({
      error: `Your WordPress user "${me.name}" has the role "${roles[0] || 'unknown'}". An Administrator or Editor role is required to publish posts and pages.`,
    }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('integrations').upsert(
    {
      user_id: user.id,
      wordpress_url: siteUrl,
      wordpress_username: username,
      wordpress_app_password: cleanPassword,
      setup_status: 'wordpress_ready',
    },
    { onConflict: 'user_id' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, siteUrl, username: me.name })
}
