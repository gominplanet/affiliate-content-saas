import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'
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
 * 3. Store the verifier in an httpOnly cookie so the callback can prove
 *    possession of the verifier when exchanging the code for a token.
 * 4. Redirect the user to twitter.com/i/oauth2/authorize.
 */
export async function GET() {
  const clientId = process.env.TWITTER_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: 'Twitter app not configured' }, { status: 500 })
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  const redirectUri = `${appUrl}/api/auth/twitter/callback`

  // PKCE: generate verifier + challenge, save verifier in a short-lived cookie
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await codeChallengeFromVerifier(codeVerifier)

  const cookieStore = await cookies()
  cookieStore.set('twitter_pkce_verifier', codeVerifier, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 minutes
  })

  // Encode user id in state so callback can identify the user without
  // depending solely on the session cookie (Twitter redirects back as a
  // top-level navigation, which usually preserves cookies, but this is a
  // belt-and-braces fallback).
  const state = Buffer.from(user.id).toString('base64url')

  const authUrl = new URL('https://twitter.com/i/oauth2/authorize')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', TWITTER_SCOPES.join(' '))
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  return NextResponse.redirect(authUrl.toString())
}
