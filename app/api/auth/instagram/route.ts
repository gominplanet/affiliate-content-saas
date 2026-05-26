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
import { metaEnabled } from '@/lib/feature-flags'

export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!

  // Resolve the user first so the reviewer test account / admins can start the
  // OAuth flow while Meta is gated for the public.
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  if (!metaEnabled({ email: user.email })) {
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&meta_disabled=1`)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tierRow } = await (supabase as any)
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
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&instagram_error=server_not_configured`)
  }

  // CSRF protection — pass user id as state so the callback can validate.
  // Instagram echoes this back; we check it matches the current session user.
  const url = buildAuthUrl({
    clientId,
    redirectUri: `${appUrl}/api/auth/instagram/callback`,
    state: user.id,
  })
  return NextResponse.redirect(url)
}
