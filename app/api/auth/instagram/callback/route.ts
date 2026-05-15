/**
 * GET /api/auth/instagram/callback
 *
 * Instagram OAuth redirect target. Exchanges the auth code for tokens,
 * fetches the IG username, and saves everything to integrations.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForTokens } from '@/services/instagram'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  if (error || !code) {
    const msg = errorDescription || error || 'no_code'
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&instagram_error=${encodeURIComponent(msg)}`)
  }

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  // CSRF — state should match the user id we passed in /api/auth/instagram
  if (state !== user.id) {
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&instagram_error=invalid_state`)
  }

  const clientId = process.env.INSTAGRAM_APP_ID
  const clientSecret = process.env.INSTAGRAM_APP_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&instagram_error=server_not_configured`)
  }

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      clientId,
      clientSecret,
      redirectUri: `${appUrl}/api/auth/instagram/callback`,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').upsert(
      {
        user_id: user.id,
        instagram_user_id: tokens.userId,
        instagram_username: tokens.username,
        instagram_access_token: tokens.accessToken,
        instagram_token_expiry: tokens.expiresAt,
      },
      { onConflict: 'user_id' },
    )

    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&instagram_connected=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'callback_failed'
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&instagram_error=${encodeURIComponent(msg.slice(0, 200))}`)
  }
}
