import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForToken, getProfile } from '@/services/twitter'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  if (error || !code) {
    return NextResponse.redirect(
      `${appUrl}/setup?tab=integrations&twitter_error=${error || 'no_code'}`,
    )
  }

  // Decode user_id from state (set during OAuth initiation)
  let userId: string | null = null
  if (state) {
    try {
      userId = Buffer.from(state, 'base64url').toString('utf-8')
    } catch { /* ignore */ }
  }
  if (!userId) {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }
  if (!userId) return NextResponse.redirect(`${appUrl}/login`)

  // Pull the PKCE verifier back out of the cookie we set during /api/auth/twitter
  const cookieStore = await cookies()
  const codeVerifier = cookieStore.get('twitter_pkce_verifier')?.value
  if (!codeVerifier) {
    return NextResponse.redirect(
      `${appUrl}/setup?tab=integrations&twitter_error=pkce_verifier_missing`,
    )
  }

  try {
    const redirectUri = `${appUrl}/api/auth/twitter/callback`
    const tokens = await exchangeCodeForToken(code, codeVerifier, redirectUri)
    const profile = await getProfile(tokens.access_token)

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const supabase = await createServerClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await supabase.from('integrations').upsert(
      {
        user_id: userId,
        twitter_access_token: tokens.access_token,
        twitter_refresh_token: tokens.refresh_token ?? null,
        twitter_user_id: profile.id,
        twitter_handle: profile.username,
        twitter_expires_at: expiresAt,
      },
      { onConflict: 'user_id' },
    )

    // Clear the verifier cookie — it's single-use.
    cookieStore.delete('twitter_pkce_verifier')

    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&twitter_connected=1`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'callback_failed'
    return NextResponse.redirect(
      `${appUrl}/setup?tab=integrations&twitter_error=${encodeURIComponent(msg.slice(0, 100))}`,
    )
  }
}
