import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { clearChannelFailures } from '@/lib/channel-health'
import { exchangeCodeForToken, getProfile } from '@/services/twitter'
import { rememberXScopes } from '@/lib/x-media'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'
import { consumeOAuthState, OAUTH_STATE_EXPIRED_MESSAGE } from '@/lib/oauth-state'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  // CONSUME THE ONE-TIME STATE FIRST (lib/oauth-state): the cookie, with the
  // PKCE verifier in it, is deleted whatever happens next, so this callback URL
  // can never be replayed.
  const verified = await consumeOAuthState('twitter', state, `${appUrl}/api/auth/twitter/callback`)

  if (error || !code) {
    return NextResponse.redirect(
      `${appUrl}/connect-socials?twitter_error=${encodeURIComponent(error || 'no_code')}`,
    )
  }

  // CSRF defense-in-depth (2026-06-02 audit): require the one-time state
  // to name the CURRENT session user. RLS + the SSR client already prevent
  // writing to another user's row, but if anyone later swaps for
  // createAdminClient (e.g. to "fix RLS" or for a refactor), this becomes
  // account-takeover. Belt + suspenders.
  const stateUserId = verified?.uid ?? null
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)
  if (!stateUserId || stateUserId !== user.id) {
    console.warn('[twitter/callback] state mismatch, possible CSRF', { hasState: !!state, sessionUid: user.id })
    return NextResponse.redirect(`${appUrl}/connect-socials?twitter_error=${encodeURIComponent(OAUTH_STATE_EXPIRED_MESSAGE)}`)
  }
  const userId = user.id

  // The PKCE verifier came back in the state cookie set by /api/auth/twitter.
  const codeVerifier = typeof verified?.data.v === 'string' ? verified.data.v : ''
  if (!codeVerifier) {
    return NextResponse.redirect(
      `${appUrl}/connect-socials?twitter_error=pkce_verifier_missing`,
    )
  }

  try {
    const redirectUri = `${appUrl}/api/auth/twitter/callback`
    const tokens = await exchangeCodeForToken(code, codeVerifier, redirectUri)
    const profile = await getProfile(tokens.access_token)

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Encrypt secret columns at rest (2026-06-02 rollout). The helper
    // walks the row and encrypts any value in INTEGRATION_SECRET_COLUMNS;
    // non-secret fields like twitter_handle pass through unchanged.
    // Reads transparently decrypt via decryptIntegrationRow().
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // THE ERROR IS READ, and a failure throws to the catch below so the user
    // lands on the error screen rather than a "Connected" one. Silently losing
    // these tokens means every later post fails against an account the UI still
    // shows as connected. PostgREST also rejects an entire write over one
    // unknown column, so a column shipped ahead of its migration would no-op
    // every connect while every screen still said Connected.
    const { error: saveErr } = await supabase.from('integrations').upsert(
      encryptIntegrationWrite({
        user_id: userId,
        twitter_access_token: tokens.access_token,
        twitter_refresh_token: tokens.refresh_token ?? null,
        twitter_user_id: profile.id,
        twitter_handle: profile.username,
        twitter_expires_at: expiresAt,
      }),
      { onConflict: 'user_id' },
    )
    if (saveErr) throw new Error(`could not save the connection: ${saveErr.message}`)

    // What X granted, recorded on its OWN update for exactly the reason the
    // comment above gives: PostgREST rejects the whole write over one unknown
    // column, so folding twitter_scopes into that upsert would mean a database
    // without migration 337 saves no tokens while the screen says Connected.
    // A swallowed failure here costs a hint, not a connection.
    await rememberXScopes(supabase, userId, tokens.scope)

    // Reconnecting must clear the "needs reconnecting" alert immediately —
    // otherwise the old failures stay the newest outcomes and it keeps nagging.
    await clearChannelFailures(supabase, userId, 'twitter')
    return NextResponse.redirect(`${appUrl}/connect-socials?twitter_connected=1`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'callback_failed'
    return NextResponse.redirect(
      `${appUrl}/connect-socials?twitter_error=${encodeURIComponent(msg.slice(0, 100))}`,
    )
  }
}
