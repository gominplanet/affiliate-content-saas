import { NextResponse } from 'next/server'

export async function GET() {
  const clientId = process.env.LINKEDIN_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) {
    return NextResponse.json({ error: 'LinkedIn app not configured' }, { status: 500 })
  }

  const redirectUri = `${appUrl}/api/auth/linkedin/callback`
  const scope = 'openid profile w_member_social'

  const url = new URL('https://www.linkedin.com/oauth/v2/authorization')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)

  return NextResponse.redirect(url.toString())
}
