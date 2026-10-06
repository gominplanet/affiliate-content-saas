import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { startOAuthState, callbackHostRedirect } from '@/lib/oauth-state'

export async function GET(request: Request) {
  const appId = process.env.PINTEREST_APP_ID
  // Strip any trailing slash so we never emit a double-slash redirect_uri
  // (Pinterest does an exact-string match against the registered URI).
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  if (!appId || !appUrl) return NextResponse.json({ error: 'Pinterest app not configured' }, { status: 500 })

  const redirectUri = `${appUrl}/api/auth/pinterest/callback`
  // START ON THE CALLBACK'S HOST so the one-time state cookie is there when
  // Pinterest sends the member back (apex and www keep separate cookies).
  const hostHop = callbackHostRedirect(request, redirectUri)
  if (hostHop) return NextResponse.redirect(hostHop)
  // boards:write is REQUIRED to create a pin on a board (Pinterest
  // rejects pin creation without it).
  const scope = 'boards:read,boards:write,pins:read,pins:write,user_accounts:read'

  // A session is required to bind `state`. The callback rejects anything that
  // is not this browser's one-time state for the logged-in user, which is what
  // stops an attacker from having a victim complete an authorization the
  // attacker started.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  const url = new URL('https://www.pinterest.com/oauth/')
  url.searchParams.set('client_id', appId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', scope)
  // RANDOM, ONE-TIME STATE (lib/oauth-state), never the guessable user id.
  url.searchParams.set('state', await startOAuthState('pinterest', user.id, redirectUri))

  return NextResponse.redirect(url.toString())
}
