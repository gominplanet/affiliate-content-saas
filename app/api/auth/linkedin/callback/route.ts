import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { exchangeCodeForToken, getProfile } from '@/services/linkedin'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/connect-socials?linkedin_error=${error || 'no_code'}`)
  }

  // Decode user ID from state (set during OAuth initiation)
  let userId: string | null = null
  if (state) {
    try {
      userId = Buffer.from(state, 'base64url').toString('utf-8')
    } catch { /* ignore */ }
  }

  // Fall back to session cookie if state decode fails
  if (!userId) {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }

  if (!userId) return NextResponse.redirect(`${appUrl}/login`)

  let step = 'token_exchange'
  try {
    const redirectUri = `${appUrl}/api/auth/linkedin/callback`
    const accessToken = await exchangeCodeForToken(code, redirectUri)

    step = 'get_profile'
    const profile = await getProfile(accessToken)

    step = 'save_token'
    const supabase = await createServerClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: saveErr } = await supabase.from('integrations').upsert(
      {
        user_id: userId,
        linkedin_access_token: accessToken,
        linkedin_person_id: profile.sub,
        linkedin_person_name: profile.name,
      },
      { onConflict: 'user_id' },
    )
    if (saveErr) throw new Error(saveErr.message || 'token save failed')

    return NextResponse.redirect(`${appUrl}/connect-socials?linkedin_connected=1`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error(`[linkedin callback] ${step} failed:`, msg)
    const detail = encodeURIComponent(`${step}: ${msg}`.slice(0, 300))
    return NextResponse.redirect(`${appUrl}/connect-socials?linkedin_error=${detail}`)
  }
}
