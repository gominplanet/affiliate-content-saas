import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { encryptIntegrationWrite } from '@/lib/integration-secrets'
import { consumeOAuthState, OAUTH_STATE_EXPIRED_MESSAGE } from '@/lib/oauth-state'
import { clearChannelFailures } from '@/lib/channel-health'
import { exchangeCodeForToken, getProfile } from '@/services/linkedin'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  // CONSUME THE ONE-TIME STATE FIRST (lib/oauth-state): the cookie is deleted
  // whatever happens next, so this callback URL can never be replayed.
  const verified = await consumeOAuthState('linkedin', state, `${appUrl}/api/auth/linkedin/callback`)
  const stateUserId = verified?.uid ?? null

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/connect-socials?linkedin_error=${error || 'no_code'}`)
  }

  // The account being linked is the SESSION's, never whatever the caller put
  // in `state`. The old code decoded a user id out of state and wrote the token
  // to it — so anyone could authorize their own LinkedIn, then replay the
  // callback with state=base64(victim id) and plant their token on that
  // account. (RLS on the server client was the only thing standing in the way.)
  // State is now purely a CSRF check, matching twitter/facebook.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  if (!stateUserId || stateUserId !== user.id) {
    console.warn('[linkedin/callback] state mismatch, possible CSRF', { hasState: !!state, sessionUid: user.id })
    return NextResponse.redirect(`${appUrl}/connect-socials?linkedin_error=${encodeURIComponent(OAUTH_STATE_EXPIRED_MESSAGE)}`)
  }
  const userId = user.id

  let step = 'token_exchange'
  try {
    const redirectUri = `${appUrl}/api/auth/linkedin/callback`
    const accessToken = await exchangeCodeForToken(code, redirectUri)

    step = 'get_profile'
    const profile = await getProfile(accessToken)

    step = 'save_token'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: saveErr } = await supabase.from('integrations').upsert(
      encryptIntegrationWrite({
        user_id: userId,
        linkedin_access_token: accessToken,
        linkedin_person_id: profile.sub,
        linkedin_person_name: profile.name,
      }),
      { onConflict: 'user_id' },
    )
    if (saveErr) throw new Error(saveErr.message || 'token save failed')

    // Reconnecting must clear the "needs reconnecting" alert immediately —
    // otherwise the old failures stay the newest outcomes and it keeps nagging.
    await clearChannelFailures(supabase, userId, 'linkedin')
    return NextResponse.redirect(`${appUrl}/connect-socials?linkedin_connected=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`[linkedin callback] ${step} failed:`, msg)
    const detail = encodeURIComponent(`${step}: ${msg}`.slice(0, 300))
    return NextResponse.redirect(`${appUrl}/connect-socials?linkedin_error=${detail}`)
  }
}
