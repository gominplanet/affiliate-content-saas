import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { startOAuthState, callbackHostRedirect } from '@/lib/oauth-state'

export async function GET(request: Request) {
  const clientId = process.env.LINKEDIN_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: 'LinkedIn app not configured' }, { status: 500 })
  }

  const redirectUri = `${appUrl}/api/auth/linkedin/callback`
  // START ON THE CALLBACK'S HOST so the one-time state cookie is there when
  // LinkedIn sends the member back (apex and www keep separate cookies).
  const hostHop = callbackHostRedirect(request, redirectUri)
  if (hostHop) return NextResponse.redirect(hostHop)

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  const scope = 'openid profile w_member_social'
  // RANDOM, ONE-TIME STATE (lib/oauth-state) bound to this user in an httpOnly
  // cookie. base64 of the user id used to be the state: guessable, reusable.
  const state = await startOAuthState('linkedin', user.id, redirectUri)

  const url = new URL('https://www.linkedin.com/oauth/v2/authorization')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
