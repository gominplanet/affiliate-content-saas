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
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&linkedin_error=${error || 'no_code'}`)
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

  try {
    const redirectUri = `${appUrl}/api/auth/linkedin/callback`
    const accessToken = await exchangeCodeForToken(code, redirectUri)
    const profile = await getProfile(accessToken)

    const supabase = await createServerClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').upsert(
      {
        user_id: userId,
        linkedin_access_token: accessToken,
        linkedin_person_id: profile.sub,
        linkedin_person_name: profile.name,
      },
      { onConflict: 'user_id' },
    )

    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&linkedin_connected=1`)
  } catch {
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&linkedin_error=callback_failed`)
  }
}
