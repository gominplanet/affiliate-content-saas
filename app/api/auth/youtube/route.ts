import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 })
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  // Where to send the user after the callback. Only same-origin relative paths
  // (start with a single "/", never "//") are honoured — guards against an
  // open redirect. Used so the onboarding funnel gets the user back to
  // /onboarding instead of dumping them on /setup mid-flow.
  const rawReturn = new URL(req.url).searchParams.get('returnTo') || ''
  const returnTo = /^\/(?!\/)/.test(rawReturn) ? rawReturn : ''

  // Encode user ID (+ optional return path) in state so the callback can
  // identify the user without a session cookie. JSON now; the callback still
  // accepts the legacy bare-uid format for any in-flight old requests.
  const state = Buffer.from(JSON.stringify({ uid: user.id, rt: returnTo })).toString('base64url')
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
