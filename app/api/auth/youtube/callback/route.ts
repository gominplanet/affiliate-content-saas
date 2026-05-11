import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  if (error || !code) {
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&youtube_error=${error || 'no_code'}`)
  }

  // Decode user ID from state
  let userId: string | null = null
  if (state) {
    try { userId = Buffer.from(state, 'base64url').toString('utf-8') } catch { /* ignore */ }
  }
  if (!userId) {
    const supabase = await createServerClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }
  if (!userId) return NextResponse.redirect(`${appUrl}/login`)

  try {
    const redirectUri = `${appUrl}/api/auth/youtube/callback`
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    })
    if (!tokenRes.ok) throw new Error('Token exchange failed')
    const tokens = await tokenRes.json() as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    const supabase = await createServerClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('integrations').upsert(
      {
        user_id: userId,
        youtube_oauth_access_token: tokens.access_token,
        ...(tokens.refresh_token && { youtube_oauth_refresh_token: tokens.refresh_token }),
        youtube_oauth_token_expiry: Date.now() + tokens.expires_in * 1000,
      },
      { onConflict: 'user_id' },
    )

    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&youtube_oauth_connected=1`)
  } catch {
    return NextResponse.redirect(`${appUrl}/setup?tab=integrations&youtube_error=callback_failed`)
  }
}
