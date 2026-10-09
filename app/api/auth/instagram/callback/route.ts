/**
 * GET /api/auth/instagram/callback
 *
 * Instagram OAuth redirect target. Exchanges the auth code for tokens,
 * fetches the IG username, and saves everything to integrations.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'
import { consumeOAuthState, OAUTH_STATE_EXPIRED_MESSAGE } from '@/lib/oauth-state'
import { clearChannelFailures } from '@/lib/channel-health'
import { exchangeCodeForTokens, subscribeToComments, fetchIgProfessionalId } from '@/services/instagram'
import { syncInstagramAccount } from '@/lib/social-accounts'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  // CONSUME THE ONE-TIME STATE FIRST (lib/oauth-state): the cookie is deleted
  // whatever happens next, so this callback URL can never be replayed.
  const verified = await consumeOAuthState('instagram', state, `${appUrl}/api/auth/instagram/callback`)
  const stateUserId = verified?.uid ?? null

  if (error || !code) {
    const msg = errorDescription || error || 'no_code'
    return NextResponse.redirect(`${appUrl}/connect-socials?instagram_error=${encodeURIComponent(msg)}`)
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  // CSRF: the state must be the one-time one this browser started in
  // /api/auth/instagram, and it must name the current session user.
  if (!stateUserId || stateUserId !== user.id) {
    console.warn('[instagram/callback] state mismatch, possible CSRF', { hasState: !!state, sessionUid: user.id })
    return NextResponse.redirect(`${appUrl}/connect-socials?instagram_error=${encodeURIComponent(OAUTH_STATE_EXPIRED_MESSAGE)}`)
  }

  const clientId = process.env.INSTAGRAM_APP_ID
  const clientSecret = process.env.INSTAGRAM_APP_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/connect-socials?instagram_error=server_not_configured`)
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId,
      clientSecret,
      redirectUri: `${appUrl}/api/auth/instagram/callback`,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // THE ERROR IS READ, and a failure throws to the catch below so the user
    // lands on the error screen rather than a "Connected" one. An account that
    // reports connected but was never saved fails later, silently, on the first
    // post. PostgREST also rejects an entire write over one unknown column, so a
    // column shipped ahead of its migration would no-op every connect while
    // every screen still said Connected.
    const { error: saveErr } = await supabase.from('integrations').upsert(
      encryptIntegrationWrite({
        user_id: user.id,
        instagram_user_id: tokens.userId,
        instagram_username: tokens.username,
        instagram_access_token: tokens.accessToken,
        instagram_token_expiry: tokens.expiresAt,
      }),
      { onConflict: 'user_id' },
    )
    if (saveErr) throw new Error(`could not save the connection: ${saveErr.message}`)

    // Mirror into social_accounts (single IG account, always default).
    try {
      await syncInstagramAccount(supabase, user.id, {
        externalId: tokens.userId,
        username: tokens.username,
        accessToken: tokens.accessToken,
        tokenExpiry: tokens.expiresAt,
      })
    } catch (e) {
      console.warn('[instagram/callback] syncInstagramAccount failed:', e)
    }

    // THE PROFESSIONAL ID TOO. Comment webhooks name the account by it, not by
    // the app-scoped id saved above, so without it a comment on a post MVP did
    // not publish could not be traced back to its owner. Best-effort.
    try {
      const proId = await fetchIgProfessionalId(tokens.accessToken)
      if (proId) await supabase.from('integrations').update({ instagram_business_id: proId } as never).eq('user_id', user.id)
    } catch (e) {
      console.warn('[instagram/callback] professional id not saved:', e)
    }

    // Auto-subscribe this account to the `comments` webhook so comment→DM works
    // the moment it's connected — the one setup step a user can't do themselves
    // (it otherwise needs a per-account toggle in the Meta dashboard). Only fires
    // if the token carries the comment permission; harmless no-op otherwise.
    try {
      await subscribeToComments({ igUserId: tokens.userId, accessToken: tokens.accessToken })
    } catch (e) {
      console.warn('[instagram/callback] subscribeToComments failed:', e)
    }

    // Reconnecting must clear the "needs reconnecting" alert immediately —
    // otherwise the old failures stay the newest outcomes and it keeps nagging.
    await clearChannelFailures(supabase, user.id, 'instagram')
    return NextResponse.redirect(`${appUrl}/connect-socials?instagram_connected=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'callback_failed'
    return NextResponse.redirect(`${appUrl}/connect-socials?instagram_error=${encodeURIComponent(msg.slice(0, 200))}`)
  }
}
