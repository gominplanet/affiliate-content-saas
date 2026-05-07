import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteUrl: rawUrl, username, appPassword } = await request.json()
  if (!rawUrl || !username || !appPassword) {
    return NextResponse.json({ error: 'Site URL, username and Application Password are required.' }, { status: 400 })
  }

  // Normalize URL
  let siteUrl = rawUrl.trim()
  if (!siteUrl.startsWith('http')) siteUrl = `https://${siteUrl}`
  siteUrl = siteUrl.replace(/\/wp-admin\/?.*$/, '').replace(/\/$/, '')

  // Strip spaces from Application Password (WordPress format: xxxx xxxx xxxx)
  const cleanPassword = appPassword.replace(/\s+/g, '')
  const encoded = Buffer.from(`${username}:${cleanPassword}`).toString('base64')

  // Validate credentials + check publish permissions against WordPress
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
      return NextResponse.json({ error: 'Authentication failed. Check your username and Application Password.' }, { status: 400 })
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

  // Save validated credentials
  const { error } = await supabase.from('integrations').upsert(
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
