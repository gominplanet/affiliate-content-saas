/**
 * GET /api/auth/instagram
 *
 * Kicks off the Instagram OAuth dance. Redirects to instagram.com/oauth
 * with our app id, the registered redirect URI, and the scopes we need
 * for publishing Reels + Stories.
 *
 * Tier-gated: Instagram fan-out is Pro-only.
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { buildAuthUrl } from '@/services/instagram'
import { tierAllowsSocial, type Tier } from '@/lib/tier'
import { metaEnabledForUser } from '@/lib/feature-flags'
import { startOAuthState, callbackHostRedirect } from '@/lib/oauth-state'

export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const redirectUri = `${appUrl}/api/auth/instagram/callback`
  // START ON THE CALLBACK'S HOST so the one-time state cookie is there when
  // Instagram sends the member back (apex and www keep separate cookies).
  const hostHop = callbackHostRedirect(request, redirectUri)
  if (hostHop) return NextResponse.redirect(hostHop)

  // Resolve the user first so the reviewer test account / admins can start the
  // OAuth flow while Meta is gated for the public.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  if (!(await metaEnabledForUser(supabase, user))) {
    return NextResponse.redirect(`${appUrl}/connect-socials?meta_disabled=1`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await supabase
    .from('integrations')
    .select('tier')
    .eq('user_id', user.id)
    .single()
  const tier = (tierRow?.tier as Tier) ?? 'trial'
  if (!tierAllowsSocial(tier, 'instagram')) {
    return NextResponse.redirect(`${appUrl}/pricing?reason=instagram_requires_pro`)
  }

  const clientId = process.env.INSTAGRAM_APP_ID
  if (!clientId) {
    return NextResponse.redirect(`${appUrl}/connect-socials?instagram_error=server_not_configured`)
  }

  // CSRF protection: a RANDOM, ONE-TIME state (lib/oauth-state) bound to this
  // user in an httpOnly cookie. Instagram echoes it back and the callback
  // verifies and burns it. The bare user id used to be the state: guessable.
  const url = buildAuthUrl({
    clientId,
    redirectUri,
    state: await startOAuthState('instagram', user.id, redirectUri),
  })
  return NextResponse.redirect(url)
}
