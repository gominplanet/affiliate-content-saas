import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 })
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  // Encode user ID in state so callback can identify user without session cookie
  const state = Buffer.from(user.id).toString('base64url')
  const redirectUri = `${appUrl}/api/auth/youtube/callback`

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', [
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.force-ssl',
  ].join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent') // force refresh token
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
