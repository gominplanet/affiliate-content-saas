/**
 * GET /api/auth/gsc — start the Google Search Console OAuth flow.
 *
 * Reuses the same Google OAuth app as YouTube (GOOGLE_CLIENT_ID/SECRET) but
 * requests the read-only Search Console scope. The callback stores tokens on
 * integrations.gsc_oauth_* and resolves the matching GSC property.
 *
 * NOTE (ops): the redirect URI /api/auth/gsc/callback and the
 * webmasters.readonly scope must be added to the Google Cloud OAuth client /
 * consent screen.
 */
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

  const state = Buffer.from(user.id).toString('base64url')
  const redirectUri = `${appUrl}/api/auth/gsc/callback`

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  // webmasters.readonly  → Search Analytics + URL Inspection (the
  //                        original feature set — indexed/clicks/impressions).
  // indexing              → programmatic "Request Indexing" via the
  //                        Indexing API (POST urlNotifications:publish).
  //                        Lets us replace the old "open GSC, hit the button
  //                        yourself" loop with a one-click server call.
  url.searchParams.set('scope', [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/indexing',
  ].join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent') // force a refresh token
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
