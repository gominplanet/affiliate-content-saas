import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { maybeEncrypt } from '@/lib/secrets'

export async function POST(request: Request) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { siteUrl: rawUrl, username, password } = await request.json()
  if (!rawUrl || !username || !password) {
    return NextResponse.json({ error: 'Site URL, username and password are required.' }, { status: 400 })
  }

  // Normalize URL
  let siteUrl = rawUrl.trim()
  if (!siteUrl.startsWith('http')) siteUrl = `https://${siteUrl}`
  siteUrl = siteUrl.replace(/\/wp-admin\/?.*$/, '').replace(/\/$/, '')

  // Verify the site is reachable
  try {
    const pingRes = await fetch(`${siteUrl}/wp-json/`, { method: 'GET' })
    if (!pingRes.ok) {
      return NextResponse.json({ error: `Could not reach your WordPress site (HTTP ${pingRes.status}). Double-check the URL.` }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Could not reach your WordPress site. Double-check the URL.' }, { status: 400 })
  }

  // Save credentials — the WordPress service handles auth automatically:
  // it tries Basic auth first, then falls back to session-based login (works on Hostinger)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase.from('integrations').upsert(
    {
      user_id: user.id,
      wordpress_url: siteUrl,
      wordpress_username: username,
      // Encrypt at rest (2026-06-02). Reads transparently decrypt
      // via maybeDecrypt() in lib/wordpress-sites.ts.
      wordpress_app_password: maybeEncrypt(password.replace(/\s+/g, '')),
      setup_status: 'wordpress_ready',
    },
    { onConflict: 'user_id' },
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, siteUrl, username })
}
