import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// Redirects to the pre-built static theme ZIP
export async function GET() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.redirect(
    new URL('/downloads/kadence-affiliate-child.zip', process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  )
}

// Sets WordPress reading settings (non-critical, used optionally)
export async function POST() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: integration } = await supabase
    .from('integrations')
    .select('wordpress_url, wordpress_username, wordpress_app_password')
    .eq('user_id', user.id)
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = integration as any
  if (!row?.wordpress_url) {
    return NextResponse.json({ error: 'WordPress not connected' }, { status: 400 })
  }

  return NextResponse.json({
    success: true,
    message: 'Download the theme ZIP and upload via WordPress Admin → Appearance → Themes → Add New.',
  })
}
