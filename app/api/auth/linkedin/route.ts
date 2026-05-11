import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const clientId = process.env.LINKEDIN_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: 'LinkedIn app not configured' }, { status: 500 })
  }

  // Get user now (while session cookie is definitely available) and encode in state
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${appUrl}/login`)

  const redirectUri = `${appUrl}/api/auth/linkedin/callback`
  const scope = 'openid profile w_member_social'
  // Encode user ID in state so callback can identify user without needing the session cookie
  const state = Buffer.from(user.id).toString('base64url')

  const url = new URL('https://www.linkedin.com/oauth/v2/authorization')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', state)

  return NextResponse.redirect(url.toString())
}
