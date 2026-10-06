import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { startOAuthState, callbackHostRedirect } from '@/lib/oauth-state'
import {
  TWITTER_SCOPES,
  generateCodeVerifier,
  codeChallengeFromVerifier,
} from '@/services/twitter'

/**
 * Twitter OAuth 2.0 (PKCE) entry point.
 *
 * 1. Authenticate the user (must be signed in).
 * 2. Generate a random PKCE code_verifier and derived code_challenge.
 * 3. Store the verifier, with a random one-time state, in the httpOnly
 *    state cookie (lib/oauth-state) so the callback can prove possession of
 *    the verifier when exchanging the code for a token.
 * 4. Redirect the user to twitter.com/i/oauth2/authorize.
 */
export async function GET(request: Request) {
  const clientId = process.env.TWITTER_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: 'Twitter app not configured' }, { status: 500 })
  }

  const redirectUri = `${appUrl}/api/auth/twitter/callback`
  // START ON THE CALLBACK'S HOST so the one-time state cookie is there when
  // X sends the member back (apex and www keep separate cookies).
  const hostHop = callbackHostRedirect(request, redirectUri)
  if (hostHop) return NextResponse.redirect(hostHop)

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  // PKCE: generate verifier + challenge.
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await codeChallengeFromVerifier(codeVerifier)

  // RANDOM, ONE-TIME STATE (lib/oauth-state). The PKCE verifier rides in the
  // same short-lived httpOnly cookie, so one cookie proves both "this browser
  // started it" and "we hold the verifier". base64 of the user id used to be
  // the state: guessable and reusable.
  const state = await startOAuthState('twitter', user.id, redirectUri, { v: codeVerifier })

  // Use x.com (not twitter.com) for the authorize endpoint. After X's
  // twitter.com → x.com migration, the user's login session cookie is set on
  // x.com. Sending them to twitter.com/i/oauth2/authorize lands on a domain
  // that can't read that cookie, so X shows "you have to be logged in to X"
  // and loops forever even after a correct username/password login. Same
  // OAuth flow, same client_id — just the domain where the session lives.
  const authUrl = new URL('https://x.com/i/oauth2/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', TWITTER_SCOPES.join(' '))
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  return NextResponse.redirect(authUrl.toString())
}
