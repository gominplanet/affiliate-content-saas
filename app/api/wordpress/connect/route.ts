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

  // Save credentials to Supabase — validated on first publish
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

  return NextResponse.json({ success: true, siteUrl })
}
